"""Full-information state of one kyoku, driven purely by mjai events.

The live engine and the log replayer (tests, review) share this class: every
event is applied through ``KyokuState.apply``, so scoring sees exactly the
same state in both cases.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from backend.engine.tiles import HONORS, kind

LIVE_DRAWS = 70  # 136 - 14 dead wall - 52 dealt
DRAGONS = {kind(t) for t in HONORS[4:]}
WIND_KINDS = {kind(t) for t in HONORS[:4]}


@dataclass
class Meld:
    type: str  # chi | pon | daiminkan | ankan | kakan
    pai: str | None  # called (or, for kakan, added) tile; None for ankan
    consumed: list[str]
    target: int | None

    @property
    def tiles(self) -> list[str]:
        return self.consumed + ([self.pai] if self.pai else [])

    @property
    def is_kan(self) -> bool:
        return self.type in ("daiminkan", "ankan", "kakan")


@dataclass
class Discard:
    pai: str
    tsumogiri: bool
    riichi: bool = False  # the riichi declaration tile
    called: bool = False  # taken by another player


@dataclass
class SeatState:
    hand: list[str] = field(default_factory=list)  # concealed tiles, incl. drawn tile
    melds: list[Meld] = field(default_factory=list)
    river: list[Discard] = field(default_factory=list)
    riichi_declared: bool = False
    riichi_accepted: bool = False
    double_riichi: bool = False
    ippatsu: bool = False
    # (liable seat, yaku name) for daisangen / daisuushii pao
    pao: tuple[int, str] | None = None

    @property
    def is_closed(self) -> bool:
        return all(m.type == "ankan" for m in self.melds)

    def remove(self, tiles: list[str]) -> None:
        for t in tiles:
            self.hand.remove(t)


class KyokuState:
    def __init__(self, start: dict):
        assert start["type"] == "start_kyoku"
        self.bakaze: str = start["bakaze"]
        self.kyoku: int = start["kyoku"]  # 1-based, as in mjai
        self.honba: int = start["honba"]
        self.kyotaku: int = start["kyotaku"]
        self.oya: int = start["oya"]
        self.scores: list[int] = list(start["scores"])
        self.dora_markers: list[str] = [start["dora_marker"]]
        self.seats = [SeatState(hand=list(h)) for h in start["tehais"]]
        self.tiles_left = LIVE_DRAWS
        self.any_call = False  # any call (incl. ankan) so far this kyoku
        self.discard_count = 0
        self.kan_owners: list[int] = []
        self.last_event: dict = start
        self.last_tsumo: tuple[int, str] | None = None
        # (actor, tile, event type) of the tile others may ron right now:
        # a discard, or the tile of a kakan / ankan (chankan).
        self.claimable: tuple[int, str, str] | None = None
        self.rinshan = False  # the current tsumo is a rinshan draw
        # Set after the first hora of a multi-ron: honba and deposits are paid once.
        self.pot_taken = False
        self._kan_draw_next = False

    # -- queries -----------------------------------------------------------

    def has_discarded(self, seat: int) -> bool:
        return bool(self.seats[seat].river)

    @property
    def is_first_go_around(self) -> bool:
        return not self.any_call and self.discard_count < 4

    # -- event application -------------------------------------------------

    def apply(self, ev: dict) -> None:
        t = ev["type"]
        handler = getattr(self, f"_on_{t}", None)
        if handler is not None:
            handler(ev)
        self.last_event = ev

    def _on_tsumo(self, ev: dict) -> None:
        seat = self.seats[ev["actor"]]
        seat.hand.append(ev["pai"])
        self.tiles_left -= 1
        self.rinshan = self._kan_draw_next
        self._kan_draw_next = False
        self.last_tsumo = (ev["actor"], ev["pai"])

    def _on_dahai(self, ev: dict) -> None:
        actor = ev["actor"]
        seat = self.seats[actor]
        seat.remove([ev["pai"]])
        riichi = seat.riichi_declared and not seat.riichi_accepted
        seat.river.append(Discard(ev["pai"], ev.get("tsumogiri", False), riichi=riichi))
        if seat.riichi_accepted:
            seat.ippatsu = False
        self.discard_count += 1
        self.rinshan = False
        self.claimable = (actor, ev["pai"], "dahai")

    def _call(self, ev: dict, meld_type: str) -> None:
        actor, target = ev["actor"], ev["target"]
        seat = self.seats[actor]
        seat.remove(ev["consumed"])
        seat.melds.append(Meld(meld_type, ev["pai"], list(ev["consumed"]), target))
        self.seats[target].river[-1].called = True
        self._after_call()
        if meld_type in ("pon", "daiminkan"):
            self._check_pao(actor, target)

    def _on_chi(self, ev: dict) -> None:
        self._call(ev, "chi")

    def _on_pon(self, ev: dict) -> None:
        self._call(ev, "pon")

    def _on_daiminkan(self, ev: dict) -> None:
        self._call(ev, "daiminkan")
        self._kan(ev["actor"])

    def _on_ankan(self, ev: dict) -> None:
        seat = self.seats[ev["actor"]]
        seat.remove(ev["consumed"])
        seat.melds.append(Meld("ankan", None, list(ev["consumed"]), None))
        self._after_call()
        self._kan(ev["actor"])
        self.claimable = (ev["actor"], ev["consumed"][0], "ankan")

    def _on_kakan(self, ev: dict) -> None:
        seat = self.seats[ev["actor"]]
        seat.remove([ev["pai"]])
        k = kind(ev["pai"])
        meld = next(m for m in seat.melds if m.type == "pon" and kind(m.pai) == k)
        meld.type = "kakan"
        meld.consumed = meld.consumed + [meld.pai]
        meld.pai = ev["pai"]
        self._after_call()
        self._kan(ev["actor"])
        self.claimable = (ev["actor"], ev["pai"], "kakan")

    def _after_call(self) -> None:
        self.any_call = True
        for s in self.seats:
            s.ippatsu = False

    def _kan(self, actor: int) -> None:
        self.kan_owners.append(actor)
        self._kan_draw_next = True

    def _check_pao(self, actor: int, target: int) -> None:
        seat = self.seats[actor]
        open_sets = {kind(m.tiles[0]) for m in seat.melds if m.type != "chi"}
        if seat.pao is None:
            if len(open_sets & DRAGONS) == 3:
                seat.pao = (target, "Daisangen")
            elif len(open_sets & WIND_KINDS) == 4:
                seat.pao = (target, "Dai Suushii")

    def _on_dora(self, ev: dict) -> None:
        self.dora_markers.append(ev["dora_marker"])

    def _on_reach(self, ev: dict) -> None:
        actor = ev["actor"]
        seat = self.seats[actor]
        seat.riichi_declared = True
        seat.double_riichi = not self.has_discarded(actor) and not self.any_call

    def _on_reach_accepted(self, ev: dict) -> None:
        actor = ev["actor"]
        seat = self.seats[actor]
        seat.riichi_accepted = True
        seat.ippatsu = True
        self.scores[actor] -= 1000
        self.kyotaku += 1

    def _on_hora(self, ev: dict) -> None:
        self._apply_deltas(ev["deltas"])
        self.kyotaku = 0
        self.pot_taken = True

    def _on_ryukyoku(self, ev: dict) -> None:
        self._apply_deltas(ev["deltas"])

    def _apply_deltas(self, deltas: list[int]) -> None:
        for i, d in enumerate(deltas):
            self.scores[i] += d


def win_tile_for(st: KyokuState, actor: int, target: int) -> str:
    """The winning tile of a hora about to be applied to ``st``."""
    if actor == target:
        assert st.last_tsumo and st.last_tsumo[0] == actor
        return st.last_tsumo[1]
    assert st.claimable and st.claimable[0] == target
    return st.claimable[1]
