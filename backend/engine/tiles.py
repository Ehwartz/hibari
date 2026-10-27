"""Tile helpers.

Tiles are mjai strings: ``1m``..``9m``, ``1p``..``9p``, ``1s``..``9s``,
honors ``E S W N P F C`` (P = haku, F = hatsu, C = chun), and red fives
``5mr 5pr 5sr``. "Kind" is the 34-index with red fives folded in.
"""
from __future__ import annotations

from collections.abc import Iterable

HONORS = ["E", "S", "W", "N", "P", "F", "C"]
KINDS: list[str] = [f"{n}{s}" for s in "mps" for n in range(1, 10)] + HONORS
AKA = ("5mr", "5pr", "5sr")
WINDS = ("E", "S", "W", "N")

_KIND_INDEX = {t: i for i, t in enumerate(KINDS)}


def deaka(tile: str) -> str:
    return tile[:2] if tile in AKA else tile


def is_aka(tile: str) -> bool:
    return tile in AKA


def kind(tile: str) -> int:
    return _KIND_INDEX[deaka(tile)]


def is_yaochu(tile: str) -> bool:
    k = kind(tile)
    return k >= 27 or k % 9 in (0, 8)


def dora_kind(marker: str) -> int:
    """34-index of the dora indicated by ``marker``."""
    k = kind(marker)
    if k < 27:
        return k // 9 * 9 + (k % 9 + 1) % 9
    if k < 31:
        return 27 + (k - 27 + 1) % 4
    return 31 + (k - 31 + 1) % 3


def sort_key(tile: str) -> tuple[int, bool]:
    return kind(tile), not is_aka(tile)


def to_34(tiles: Iterable[str]) -> list[int]:
    counts = [0] * 34
    for t in tiles:
        counts[kind(t)] += 1
    return counts


def full_set(aka: bool = True) -> list[str]:
    """All 136 tiles; with ``aka`` one five of each suit is red."""
    tiles = [t for t in KINDS for _ in range(4)]
    if aka:
        for red in AKA:
            tiles[tiles.index(deaka(red))] = red
    return tiles


def to_136(tiles: Iterable[str]) -> list[int]:
    """Assign distinct 136-format ids (as used by the ``mahjong`` library).

    Red fives get the library's red ids (16 / 52 / 88, i.e. the first copy of
    the kind); plain fives use the other three copies. Ids are allocated in
    order, so convert a whole hand (concealed + melds) in one call.
    """
    used = [0] * 34
    out = []
    for t in tiles:
        k = kind(t)
        if is_aka(t):
            out.append(4 * k)
            continue
        offset = used[k] + (1 if k in (4, 13, 22) else 0)
        if offset > 3:
            raise ValueError(f"too many copies of {t}")
        used[k] += 1
        out.append(4 * k + offset)
    return out
