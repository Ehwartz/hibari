"""A fast rule-based agent for engine fuzzing (no neural net).

Always wins when it can, always riichis, discards to minimise shanten and
calls / kans at random so the engine sees every kind of action.
"""
from __future__ import annotations

import json
import random

from mahjong.shanten import Shanten

from backend import mortal
from backend.engine.tiles import AKA, KINDS, deaka, kind


def _kind(t: str | int) -> int:
    return t if isinstance(t, int) else kind(t)


class SimpleAgent:
    def __init__(self, seat: int, seed: int | None = None, call_rate: float = 0.3, kan_rate: float = 0.5):
        self.seat = seat
        self.rng = random.Random(seed)
        self.call_rate = call_rate
        self.kan_rate = kan_rate
        self.ps = None
        self._forbidden: set[int] = set()
        self._pons: dict[int, list[str]] = {}  # kind -> tiles of my pon (for kakan)

    def react(self, event: dict) -> dict | None:
        if event["type"] == "start_game":
            self.ps = mortal.libriichi().state.PlayerState(self.seat)
        cans = self.ps.update(json.dumps(event))
        if event["type"] == "start_kyoku":
            self._pons = {}
        if event["type"] in ("chi", "pon") and event["actor"] == self.seat:
            self._forbidden = self._kuikae(event)
            if event["type"] == "pon":
                self._pons[kind(event["pai"])] = event["consumed"] + [event["pai"]]
        elif event["type"] == "dahai" and event["actor"] == self.seat:
            self._forbidden = set()
        if not cans.can_act:
            return None
        return self._decide(cans, event)

    def _decide(self, c, event: dict) -> dict:
        me, rng = self.seat, self.rng
        if c.can_tsumo_agari:
            return {"type": "hora", "actor": me, "target": me}
        if c.can_ron_agari:
            return {"type": "hora", "actor": me, "target": c.target_actor}
        if c.can_ryukyoku and rng.random() < 0.5:
            return {"type": "ryukyoku", "actor": me}
        if c.can_riichi:
            return {"type": "reach", "actor": me}
        if c.can_ankan and rng.random() < self.kan_rate:
            k = _kind(self.ps.ankan_candidates()[0])
            return {"type": "ankan", "actor": me, "consumed": self._take(k, 4)}
        if c.can_kakan and rng.random() < self.kan_rate:
            k = _kind(self.ps.kakan_candidates()[0])
            pai = self._take(k, 1)[0]
            return {"type": "kakan", "actor": me, "pai": pai, "consumed": self._pons[k]}
        if c.can_discard:
            return self._discard(event)

        pai = event["pai"]
        k, target = kind(pai), event["actor"]
        if c.can_daiminkan and rng.random() < self.call_rate * self.kan_rate:
            return {"type": "daiminkan", "actor": me, "target": target, "pai": pai, "consumed": self._take(k, 3)}
        if c.can_pon and rng.random() < self.call_rate:
            return {"type": "pon", "actor": me, "target": target, "pai": pai, "consumed": self._take(k, 2)}
        chis = [(c.can_chi_low, (1, 2)), (c.can_chi_mid, (-1, 1)), (c.can_chi_high, (-2, -1))]
        chis = [offs for ok, offs in chis if ok]
        if chis and rng.random() < self.call_rate:
            offs = rng.choice(chis)
            consumed = [self._take(k + d, 1)[0] for d in offs]
            return {"type": "chi", "actor": me, "target": target, "pai": pai, "consumed": consumed}
        return {"type": "none"}

    def _discard(self, event: dict) -> dict:
        me = self.seat
        tsumo = event["pai"] if event["type"] == "tsumo" and event["actor"] == me else None
        if self.ps.self_riichi_accepted and tsumo:
            return {"type": "dahai", "actor": me, "pai": tsumo, "tsumogiri": True}
        hand = self._hand()
        counts = [0] * 34
        for t in hand:
            counts[kind(t)] += 1
        best, choices = 99, []
        for t in sorted(set(hand)):
            if kind(t) in self._forbidden:
                continue
            counts[kind(t)] -= 1
            sh = Shanten.calculate_shanten(counts)
            counts[kind(t)] += 1
            if sh < best:
                best, choices = sh, [t]
            elif sh == best:
                choices.append(t)
        pai = tsumo if tsumo in choices else self.rng.choice(choices)
        return {"type": "dahai", "actor": me, "pai": pai, "tsumogiri": pai == tsumo}

    # -- hand helpers --

    def _hand(self) -> list[str]:
        tiles = [KINDS[k] for k, n in enumerate(self.ps.tehai) for _ in range(n)]
        for i, has in enumerate(self.ps.akas_in_hand):
            if has:
                tiles[tiles.index(deaka(AKA[i]))] = AKA[i]
        return tiles

    def _take(self, k: int, n: int) -> list[str]:
        """``n`` tiles of kind ``k`` from hand, red five first."""
        same = sorted((t for t in self._hand() if kind(t) == k), key=lambda t: t not in AKA)
        return same[:n]

    @staticmethod
    def _kuikae(ev: dict) -> set[int]:
        k = kind(ev["pai"])
        forbidden = {k}
        if ev["type"] == "chi" and k < 27:
            lo = min(kind(t) for t in ev["consumed"])
            hi = max(kind(t) for t in ev["consumed"])
            if k < lo and (k + 3) // 9 == k // 9:
                forbidden.add(k + 3)
            if k > hi and k % 9 >= 3:
                forbidden.add(k - 3)
        return forbidden
