"""Hand scoring (via the ``mahjong`` library) and point transfers.

Payment conventions match libriichi's arena (Tenhou): honba 300 per ron /
100 per payer on tsumo; in a multi-ron, honba and riichi deposits both go to
the winner closest to the discarder only.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from mahjong.agari import Agari
from mahjong.hand_calculating.hand import HandCalculator
from mahjong.hand_calculating.hand_config import HandConfig, OptionalRules
from mahjong.meld import Meld as LibMeld

from backend.engine.state import KyokuState, SeatState, win_tile_for
from backend.engine.tiles import WINDS, is_yaochu, to_34, to_136

_OPTIONS = OptionalRules(
    has_open_tanyao=True,
    has_aka_dora=True,
    has_double_yakuman=False,
    kiriage=False,
    fu_for_open_pinfu=True,
    fu_for_pinfu_tsumo=False,
)

_LIB_MELD = {
    "chi": LibMeld.CHI,
    "pon": LibMeld.PON,
    "daiminkan": LibMeld.KAN,
    "ankan": LibMeld.KAN,
    "kakan": LibMeld.SHOUMINKAN,
}


class ScoringError(Exception):
    pass


@dataclass
class HoraResult:
    actor: int
    target: int
    pai: str
    han: int
    fu: int
    yaku: list[tuple[str, int]]
    yakuman: int  # number of yakuman (0 for normal hands)
    points: int  # hand value before honba / deposits
    deltas: list[int]
    ura_markers: list[str] = field(default_factory=list)

    @property
    def is_tsumo(self) -> bool:
        return self.actor == self.target


def evaluate_hora(st: KyokuState, actor: int, target: int, ura_markers: list[str]) -> HoraResult:
    """Score a hora about to be applied to ``st`` (the state before the event).

    For a multi-ron, call this in seat order from the discarder and apply each
    hora event before scoring the next (honba / deposits go to the first).
    """
    seat = st.seats[actor]
    tsumo = actor == target
    pai = win_tile_for(st, actor, target)
    concealed = list(seat.hand) if tsumo else seat.hand + [pai]

    meld_tiles = [m.tiles for m in seat.melds]
    ids = to_136(concealed + [t for ts in meld_tiles for t in ts])
    win_id = ids[concealed.index(pai)]
    melds, pos = [], len(concealed)
    for m, ts in zip(seat.melds, meld_tiles):
        melds.append(LibMeld(_LIB_MELD[m.type], sorted(ids[pos : pos + len(ts)]), opened=m.type != "ankan"))
        pos += len(ts)

    chankan = not tsumo and st.claimable is not None and st.claimable[2] in ("kakan", "ankan")
    first_draw = tsumo and not st.has_discarded(actor) and not st.any_call and not st.rinshan
    config = HandConfig(
        is_tsumo=tsumo,
        is_riichi=seat.riichi_accepted,
        is_ippatsu=seat.ippatsu,
        is_rinshan=tsumo and st.rinshan,
        is_chankan=chankan,
        is_haitei=tsumo and st.tiles_left == 0 and not st.rinshan,
        is_houtei=not tsumo and st.tiles_left == 0 and not chankan,
        is_daburu_riichi=seat.double_riichi and seat.riichi_accepted,
        is_tenhou=first_draw and actor == st.oya,
        is_chiihou=first_draw and actor != st.oya,
        player_wind=27 + (actor - st.oya) % 4,
        round_wind=27 + WINDS.index(st.bakaze),
        options=_OPTIONS,
    )
    res = HandCalculator.estimate_hand_value(
        ids,
        win_id,
        melds=melds,
        dora_indicators=to_136(st.dora_markers),
        ura_dora_indicators=to_136(ura_markers) if seat.riichi_accepted else None,
        config=config,
    )
    if res.error:
        raise ScoringError(f"seat {actor} hora on {pai}: {res.error} (hand {concealed}, melds {meld_tiles})")

    is_open = not seat.is_closed
    yaku = [(y.name, y.han_open if is_open else y.han_closed) for y in res.yaku]
    yakuman = res.han // 13 if any(y.is_yakuman for y in res.yaku) else 0
    main, additional = res.cost["main"], res.cost["additional"]
    oya_win = actor == st.oya
    if not tsumo:
        points = main
    elif oya_win:
        points = main * 3
    else:
        points = main + additional * 2

    honba = 0 if st.pot_taken else st.honba
    deltas = [0] * 4
    if tsumo:
        for s in range(4):
            if s == actor:
                continue
            pay = main if (oya_win or s == st.oya) else additional
            deltas[s] -= pay + 100 * honba
    else:
        deltas[target] -= main + 300 * honba
    _apply_pao(deltas, seat, res.yaku, res.han, actor, target, oya_win, honba)
    deltas[actor] = -sum(deltas) + 1000 * st.kyotaku

    return HoraResult(
        actor=actor,
        target=target,
        pai=pai,
        han=res.han,
        fu=res.fu,
        yaku=yaku,
        yakuman=yakuman,
        points=points,
        deltas=deltas,
        ura_markers=list(ura_markers) if seat.riichi_accepted else [],
    )


def _apply_pao(deltas, seat: SeatState, yaku, han, actor, target, oya_win, honba) -> None:
    """Sekinin barai for daisangen / daisuushii (Tenhou / libriichi arena).

    The whole hand value counts, composite yakuman included. Tsumo: the
    liable player pays everything as if they dealt in. Ron: the liable player
    and the discarder split it, the liable player also pays the honba.
    """
    if seat.pao is None:
        return
    liable, pao_yaku = seat.pao
    if not any(y.name == pao_yaku for y in yaku):
        return
    ron_value = 8000 * (han // 13) * (6 if oya_win else 4)
    deltas[:] = [0] * 4
    if actor == target:
        deltas[liable] = -(ron_value + 300 * honba)
    else:
        deltas[liable] -= ron_value // 2 + 300 * honba
        deltas[target] -= ron_value // 2


# -- draws -----------------------------------------------------------------


def waits(seat: SeatState) -> list[int]:
    """34-kinds the concealed hand waits on (excluding kinds already held 4x)."""
    counts = to_34(seat.hand)
    held = to_34(seat.hand + [t for m in seat.melds for t in m.tiles])
    out = []
    for k in range(34):
        if held[k] >= 4:
            continue
        counts[k] += 1
        if Agari.is_agari(counts):
            out.append(k)
        counts[k] -= 1
    return out


def is_tenpai(seat: SeatState) -> bool:
    return bool(waits(seat))


def nagashi_seats(st: KyokuState) -> list[int]:
    return [
        i
        for i, s in enumerate(st.seats)
        if s.river and all(is_yaochu(d.pai) and not d.called for d in s.river)
    ]


def exhaustive_draw_deltas(st: KyokuState) -> tuple[list[int], list[bool], list[int]]:
    """Returns (deltas, tenpai per seat, nagashi mangan seats)."""
    tenpai = [is_tenpai(s) for s in st.seats]
    nagashi = nagashi_seats(st)
    deltas = [0] * 4
    if nagashi:
        for w in nagashi:
            for s in range(4):
                if s == w:
                    continue
                pay = 4000 if (w == st.oya or s == st.oya) else 2000
                deltas[s] -= pay
                deltas[w] += pay
        return deltas, tenpai, nagashi
    n = sum(tenpai)
    if 0 < n < 4:
        for s in range(4):
            deltas[s] = 3000 // n if tenpai[s] else -3000 // (4 - n)
    return deltas, tenpai, nagashi


__all__ = [
    "HoraResult",
    "ScoringError",
    "evaluate_hora",
    "exhaustive_draw_deltas",
    "is_tenpai",
]
