"""The game engine: a generator that emits mjai events and consumes actions.

    game = Game(Rules(), seed=1)
    gen = game.play()
    prompt = next(gen)
    while True:
        actions = {seat: ... for seat in prompt.need}   # answer the seats that may act
        prompt = gen.send(actions)                       # StopIteration when the game ends

Every event is yielded once (as a ``Prompt``), so drivers can forward the
whole stream to agents. ``Prompt.need`` lists the seats that may act on that
event, with libriichi's ``ActionCandidate``; other seats must not answer.

Legality (furiten, kuikae, riichi waits, kan restrictions, …) is decided by
four libriichi ``PlayerState`` referees fed with each seat's masked view;
every action is checked with ``validate_reaction`` before it is applied.
"""
from __future__ import annotations

import json
import random
from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any

from backend import mortal
from backend.engine.rules import Rules
from backend.engine.scoring import HoraResult, evaluate_hora, exhaustive_draw_deltas
from backend.engine.state import KyokuState
from backend.engine.tiles import WINDS, kind
from backend.engine.wall import Wall

NONE = {"type": "none"}
CALL_PRIORITY = {"hora": 0, "pon": 1, "daiminkan": 1, "chi": 2}


@dataclass
class Prompt:
    event: dict
    need: dict[int, Any]  # seat -> libriichi ActionCandidate


@dataclass
class KyokuResult:
    bakaze: str
    kyoku: int
    honba: int
    kind: str  # hora | exhaustive | abort
    reason: str = ""  # abort reason, or "nagashi_mangan"
    horas: list[HoraResult] = field(default_factory=list)
    deltas: list[int] = field(default_factory=lambda: [0, 0, 0, 0])
    tenpai: list[bool] = field(default_factory=list)
    scores: list[int] = field(default_factory=list)  # after the kyoku


class IllegalAction(Exception):
    def __init__(self, seat: int, action: dict, reason: str):
        super().__init__(f"seat {seat}: illegal action {action}: {reason}")
        self.seat, self.action, self.reason = seat, action, reason


def mask_event(ev: dict, seat: int) -> dict:
    """The event as seen from ``seat``."""
    t = ev["type"]
    if t == "start_game":
        return {**ev, "id": seat}
    if t == "start_kyoku":
        return {**ev, "tehais": [h if i == seat else ["?"] * 13 for i, h in enumerate(ev["tehais"])]}
    if t == "tsumo" and ev["actor"] != seat:
        return {**ev, "pai": "?"}
    return ev


def _dumps(obj: dict) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


Gen = Generator[Prompt, "dict[int, dict] | None", Any]


class Game:
    def __init__(self, rules: Rules | None = None, seed: int | None = None, names: list[str] | None = None):
        self.rules = rules or Rules()
        self.seed = seed if seed is not None else random.randrange(2**63)
        self.rng = random.Random(self.seed)
        self.names = names or [f"player{i}" for i in range(4)]
        self.log: list[dict] = []
        self.results: list[KyokuResult] = []
        self.scores = [self.rules.start_points] * 4
        self.ranks: list[int] = []  # 1-based rank per seat, set at the end
        self.state: KyokuState | None = None
        self._refs: list[Any] = []

    # -- plumbing ----------------------------------------------------------

    def _emit(self, ev: dict) -> Gen:
        """Record + broadcast one event; return validated actions of the seats that may act."""
        self.log.append(ev)
        if ev["type"] == "start_kyoku":
            self.state = KyokuState(ev)
        elif self.state is not None:
            self.state.apply(ev)
        need = {}
        for seat, ref in enumerate(self._refs):
            cans = ref.update(_dumps(mask_event(ev, seat)))
            if cans.can_act:
                need[seat] = cans
        actions = (yield Prompt(ev, need)) or {}
        out = {}
        for seat in need:
            action = actions.get(seat) or NONE
            clean = {k: v for k, v in action.items() if k != "meta"}
            if clean.get("type") != "none" and clean.get("actor") != seat:
                raise IllegalAction(seat, clean, "wrong actor")
            try:
                self._refs[seat].validate_reaction(_dumps(clean))
            except Exception as ex:
                raise IllegalAction(seat, clean, str(ex)) from None
            out[seat] = clean
        return out

    # -- game --------------------------------------------------------------

    def play(self) -> Gen:
        lib = mortal.libriichi()
        self._refs = [lib.state.PlayerState(i) for i in range(4)]
        yield from self._emit({"type": "start_game", "names": self.names, "seed": [self.seed, 0]})

        rules = self.rules
        round_idx, honba, kyotaku = 0, 0, 0  # round_idx = wind * 4 + kyoku
        while True:
            oya = round_idx % 4
            result = yield from self._kyoku(round_idx, honba, kyotaku)
            st = self.state
            self.scores = list(st.scores)
            kyotaku = st.kyotaku
            result.scores = list(self.scores)
            self.results.append(result)

            renchan = result.kind == "abort" or (
                oya in [h.actor for h in result.horas]
                if result.kind == "hora"
                else result.kind == "exhaustive" and result.tenpai[oya]
            )
            if self._is_over(round_idx, renchan, result.kind, oya):
                break
            honba = honba + 1 if (renchan or result.kind != "hora") else 0
            if not renchan:
                round_idx += 1

        order = sorted(range(4), key=lambda s: (-self.scores[s], s))
        self.scores[order[0]] += kyotaku * 1000
        self.ranks = [order.index(s) + 1 for s in range(4)]
        yield from self._emit({"type": "end_game", "scores": list(self.scores)})

    def _is_over(self, round_idx: int, renchan: bool, kind_: str, oya: int) -> bool:
        rules, scores = self.rules, self.scores
        if rules.tobi and min(scores) < 0:
            return True
        if round_idx < rules.last_round:
            return False
        top = max(scores)
        if renchan:
            if kind_ == "abort" or not rules.agari_yame:
                return False
            oya_is_top = min(range(4), key=lambda s: (-scores[s], s)) == oya
            return oya_is_top and top >= rules.target_points
        if top >= rules.target_points:
            return True
        return round_idx >= rules.hard_last_round

    # -- kyoku -------------------------------------------------------------

    def _kyoku(self, round_idx: int, honba: int, kyotaku: int) -> Gen:
        oya = round_idx % 4
        wall = Wall(self.rng, self.rules.aka)
        yield from self._emit(
            {
                "type": "start_kyoku",
                "bakaze": WINDS[round_idx // 4],
                "dora_marker": wall.dora_markers[0],
                "kyoku": oya + 1,
                "honba": honba,
                "kyotaku": kyotaku,
                "oya": oya,
                "scores": list(self.scores),
                "tehais": wall.deal(oya),
            }
        )
        st = self.state
        actor, rinshan, minkan_dora = oya, False, 0
        suukaikan_pending = False

        while True:
            # -- draw and self action --
            if not rinshan and st.tiles_left == 0:
                return (yield from self._exhaustive_draw())
            pai = wall.draw_rinshan() if rinshan else wall.draw()
            acts = yield from self._emit({"type": "tsumo", "actor": actor, "pai": pai})
            action = acts[actor]
            for _ in range(minkan_dora):  # minkan dora is flipped once the rinshan draw is played
                yield from self._emit({"type": "dora", "dora_marker": wall.reveal_dora()})
            minkan_dora = 0
            t = action["type"]

            if t == "hora":
                return (yield from self._hora([actor], actor, wall))
            if t == "ryukyoku":
                return (yield from self._abort("kyuushu_kyuuhai"))
            if t in ("ankan", "kakan"):
                ev = {"type": t, "actor": actor, "consumed": action["consumed"]}
                if t == "kakan":
                    ev["pai"] = action["pai"]
                acts = yield from self._emit(ev)
                rons = [s for s, a in acts.items() if a["type"] == "hora"]
                if rons:
                    return (yield from self._hora(rons, actor, wall))
                if t == "ankan":
                    yield from self._emit({"type": "dora", "dora_marker": wall.reveal_dora()})
                else:
                    minkan_dora += 1
                suukaikan_pending = self._suukaikan(st)
                rinshan = True
                continue

            riichi = t == "reach"
            if riichi:
                acts = yield from self._emit({"type": "reach", "actor": actor})
                action = acts[actor]

            # -- discard, then calls (which lead to another discard) --
            while True:
                assert action["type"] == "dahai", action
                acts = yield from self._emit(
                    {"type": "dahai", "actor": actor, "pai": action["pai"], "tsumogiri": action["tsumogiri"]}
                )
                rons = [s for s, a in acts.items() if a["type"] == "hora"]
                if rons:
                    if len(rons) == 3 and self.rules.sanchahou_abort:
                        return (yield from self._abort("sanchahou"))
                    return (yield from self._hora(rons, actor, wall))
                if riichi:
                    riichi = False
                    yield from self._emit({"type": "reach_accepted", "actor": actor})
                    if all(s.riichi_accepted for s in st.seats):
                        return (yield from self._abort("suucha_riichi"))
                if self._suufon_renda(st):
                    return (yield from self._abort("suufon_renda"))
                if suukaikan_pending:
                    return (yield from self._abort("suukaikan"))

                calls = [a for a in acts.values() if a["type"] in CALL_PRIORITY]
                if not calls:
                    actor = (actor + 1) % 4
                    rinshan = False
                    break
                call = min(calls, key=lambda a: CALL_PRIORITY[a["type"]])
                ev = {k: call[k] for k in ("type", "actor", "target", "pai", "consumed")}
                acts = yield from self._emit(ev)
                actor = call["actor"]
                if call["type"] == "daiminkan":
                    minkan_dora += 1
                    suukaikan_pending = self._suukaikan(st)
                    rinshan = True
                    break
                action = acts[actor]

    @staticmethod
    def _suukaikan(st: KyokuState) -> bool:
        return len(st.kan_owners) == 4 and len(set(st.kan_owners)) > 1

    @staticmethod
    def _suufon_renda(st: KyokuState) -> bool:
        if st.any_call or st.discard_count != 4:
            return False
        first = [s.river[0].pai for s in st.seats if s.river]
        return len(first) == 4 and kind(first[0]) in range(27, 31) and len({kind(p) for p in first}) == 1

    # -- endings -----------------------------------------------------------

    def _hora(self, winners: list[int], target: int, wall: Wall) -> Gen:
        st = self.state
        winners = sorted(winners, key=lambda s: (s - target) % 4 or 4)
        result = KyokuResult(st.bakaze, st.kyoku, st.honba, "hora")
        for w in winners:
            ura = wall.ura_markers if st.seats[w].riichi_accepted else []
            h = evaluate_hora(st, w, target, ura)
            result.horas.append(h)
            result.deltas = [a + b for a, b in zip(result.deltas, h.deltas)]
            yield from self._emit(
                {
                    "type": "hora",
                    "actor": w,
                    "target": target,
                    "pai": h.pai,
                    "deltas": h.deltas,
                    "ura_markers": h.ura_markers,
                    "han": h.han,
                    "fu": h.fu,
                    "yaku": [list(y) for y in h.yaku],
                    "scores": [s + d for s, d in zip(st.scores, h.deltas)],
                }
            )
        yield from self._emit({"type": "end_kyoku"})
        return result

    def _exhaustive_draw(self) -> Gen:
        st = self.state
        deltas, tenpai, nagashi = exhaustive_draw_deltas(st)
        reason = "nagashi_mangan" if nagashi else "exhaustive"
        yield from self._emit({"type": "ryukyoku", "reason": reason, "deltas": deltas, "tenpai": tenpai})
        yield from self._emit({"type": "end_kyoku"})
        return KyokuResult(st.bakaze, st.kyoku, st.honba, "exhaustive", reason, deltas=deltas, tenpai=tenpai)

    def _abort(self, reason: str) -> Gen:
        st = self.state
        yield from self._emit({"type": "ryukyoku", "reason": reason, "deltas": [0, 0, 0, 0]})
        yield from self._emit({"type": "end_kyoku"})
        return KyokuResult(st.bakaze, st.kyoku, st.honba, "abort", reason)
