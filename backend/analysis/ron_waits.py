"""Ron waits for the replay's 铳牌 marks: the tiles a waiting hand could actually ron.

A wait counts only if the win has a yaku (the ``mahjong`` library scores it as a ron, with riichi and
the seat / round winds; situational yaku such as houtei or chankan are left out). Furiten is decided on
the client, which knows the rivers.
"""
from __future__ import annotations

from mahjong.hand_calculating.hand import HandCalculator
from mahjong.hand_calculating.hand_config import HandConfig
from mahjong.meld import Meld as LibMeld
from mahjong.shanten import Shanten

from backend.engine.scoring import _LIB_MELD, _OPTIONS
from backend.engine.tiles import AKA, KINDS, WINDS, deaka, to_34, to_136


def _win_tile(k: int, held: list[str]) -> str:
    """The tile of kind ``k`` to win on: a plain one, or the red five when all plain ones are held."""
    plain = KINDS[k]
    red = next((r for r in AKA if deaka(r) == plain), None)
    if red and sum(deaka(t) == plain and t != red for t in held) >= 3:
        return red
    return plain


def ron_waits(hand: list[str], melds: list[dict], riichi: bool, seat_wind: str, round_wind: str) -> dict:
    """``hand``: concealed tiles (3n+1); ``melds``: ``{"type", "tiles"}`` with all tiles of each meld.

    Returns ``waits`` (every tile that completes the hand: furiten is decided on all of them) and
    ``ron`` (those with a yaku: the tiles that would deal in)."""
    waits: list[str] = []
    ron: list[str] = []
    if len(hand) % 3 != 1:
        return {"waits": waits, "ron": ron}
    counts = to_34(hand)
    if Shanten.calculate_shanten(counts) != 0:
        return {"waits": waits, "ron": ron}
    meld_tiles = [t for m in melds for t in m["tiles"]]
    held = to_34(hand + meld_tiles)
    for k in range(34):
        if held[k] >= 4:
            continue
        counts[k] += 1
        complete = Shanten.calculate_shanten(counts) == -1
        counts[k] -= 1
        if not complete:
            continue
        waits.append(KINDS[k])
        win = _win_tile(k, hand + meld_tiles)
        ids = to_136(hand + [win] + meld_tiles)
        lib_melds, pos = [], len(hand) + 1
        for m in melds:
            n = len(m["tiles"])
            lib_melds.append(LibMeld(_LIB_MELD[m["type"]], sorted(ids[pos : pos + n]), opened=m["type"] != "ankan"))
            pos += n
        res = HandCalculator.estimate_hand_value(
            ids,
            ids[len(hand)],
            melds=lib_melds,
            config=HandConfig(
                is_tsumo=False,
                is_riichi=riichi,
                player_wind=27 + WINDS.index(seat_wind),
                round_wind=27 + WINDS.index(round_wind),
                options=_OPTIONS,
            ),
        )
        if not res.error:
            ron.append(KINDS[k])
    return {"waits": waits, "ron": ron}
