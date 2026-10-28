"""Ukeire (tile acceptance): which draws lower the shanten, and how many of them are left.

With 3n+2 tiles (your turn) every distinct discard is an option; with 3n+1 tiles the hand itself
is the only one. ``visible`` counts the tiles seen outside your hand (rivers, all melds, dora
indicators), so "remaining" is 4 minus what you can see. Chiitoitsu / kokushi count only for a
closed hand (the shanten library applies them from 13 tiles up).
"""
from __future__ import annotations

from mahjong.shanten import Shanten

from backend.engine.tiles import KINDS, is_aka, kind, to_34


def _shanten(counts: list[int]) -> int:
    return Shanten.calculate_shanten(counts)


def _option(counts: list[int], visible: list[int]) -> dict:
    """Shanten of ``counts`` and the draws that improve it."""
    base = _shanten(counts)
    tiles = []
    for k in range(34):
        left = 4 - counts[k] - visible[k]
        if left <= 0 or counts[k] >= 4:
            continue
        counts[k] += 1
        better = sum(counts) % 3 == 2 and _shanten(counts) < base
        counts[k] -= 1
        if better:
            tiles.append({"tile": KINDS[k], "left": left})
    return {"shanten": base, "tiles": tiles, "total": sum(t["left"] for t in tiles)}


def analyze(hand: list[str], visible: list[int]) -> dict:
    """``hand``: your concealed tiles (with the drawn one); ``visible``: 34 counts seen elsewhere."""
    if len(visible) != 34 or not hand or len(hand) > 14 or len(hand) % 3 == 0:
        raise ValueError("bad hand or visible counts")
    counts = to_34(hand)
    if len(hand) % 3 == 1:
        return {"discard": False, "options": [{"discard": None, **_option(counts, visible)}]}
    options = []
    seen: set[int] = set()
    # one option per kind; show a plain five when both a red and a plain one are held
    for t in sorted(hand, key=lambda t: (kind(t), is_aka(t))):
        k = kind(t)
        if k in seen:
            continue
        seen.add(k)
        counts[k] -= 1
        options.append({"discard": t, **_option(counts, visible)})
        counts[k] += 1
    options.sort(key=lambda o: (o["shanten"], -o["total"], kind(o["discard"])))
    return {"discard": True, "options": options}
