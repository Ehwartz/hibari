"""Generated quizzes: "what does this hand wait on" and "how much is this hand worth".

Hands are random but always valid: a complete hand (4 groups + a pair) is
built first, then a tile is removed (waits) or picked as the winning tile
(score). Scoring uses the same ``mahjong`` library setup as the engine, so
answers follow the game's rules (open tanyao, red fives, no kiriage mangan).
"""
from __future__ import annotations

import random

from mahjong.agari import Agari
from mahjong.hand_calculating.divider import HandDivider
from mahjong.hand_calculating.hand import HandCalculator
from mahjong.hand_calculating.hand_config import HandConfig
from mahjong.meld import Meld as LibMeld

from backend.engine.scoring import _OPTIONS
from backend.engine.tiles import AKA, KINDS, WINDS, sort_key, to_34, to_136

_SUITS = (0, 1, 2)


def _complete_hand(rng: random.Random, suits: tuple[int, ...], honors: bool) -> tuple[list[list[int]], list[int]] | None:
    """4 groups + a pair as 34-kinds, respecting 4 copies per kind; None if the draw got stuck."""
    counts = [0] * 34
    kinds = [s * 9 + n for s in suits for n in range(9)] + (list(range(27, 34)) if honors else [])
    groups: list[list[int]] = []
    for _ in range(4):
        for _attempt in range(30):
            if rng.random() < 0.65:  # sequence
                s = rng.choice(suits)
                start = s * 9 + rng.randrange(7)
                g = [start, start + 1, start + 2]
            else:
                k = rng.choice(kinds)
                g = [k, k, k]
            if all(counts[k] + g.count(k) <= 4 for k in g):
                break
        else:
            return None
        for k in g:
            counts[k] += 1
        groups.append(g)
    free = [k for k in kinds if counts[k] <= 2]
    if not free:
        return None
    k = rng.choice(free)
    return groups, [k, k]


def _tiles(kinds: list[int]) -> list[str]:
    return sorted((KINDS[k] for k in kinds), key=sort_key)


def hand_waits(hand: list[str]) -> list[str]:
    """Kinds a 13-tile concealed hand wins on (kinds already held 4x excluded)."""
    counts = to_34(hand)
    out = []
    for k in range(34):
        if counts[k] >= 4:
            continue
        counts[k] += 1
        if Agari.is_agari(counts):
            out.append(KINDS[k])
        counts[k] -= 1
    return out


def wait_forms(hand: list[str], win: str, limit: int = 3) -> list[list[list[str]]]:
    """Ways to split ``hand`` + ``win`` into groups (each group as tiles), for the answer explanation."""
    divisions = HandDivider.divide_hand(to_34(hand + [win]))
    return [[[KINDS[k] for k in g] for g in d] for d in divisions[:limit]]


def wait_question(rng: random.Random, mode: str = "mixed") -> dict:
    """A 13-tile tenpai hand. mode: "mixed" (any tiles) or "chinitsu" (one suit, many-sided waits)."""
    for _ in range(500):
        if mode == "chinitsu":
            built = _complete_hand(rng, (rng.choice(_SUITS),), honors=False)
        else:
            built = _complete_hand(rng, _SUITS, honors=rng.random() < 0.5)
        if not built:
            continue
        groups, pair = built
        kinds = [k for g in groups for k in g] + pair
        kinds.remove(rng.choice(kinds))
        hand = _tiles(kinds)
        waits = hand_waits(hand)
        # prefer multi-sided waits: they are the interesting ones
        want = 3 if mode == "chinitsu" else 2
        if len(waits) >= want or rng.random() < 0.15:
            return {"mode": mode, "hand": hand, "waits": waits, "forms": {w: wait_forms(hand, w) for w in waits}}
    raise RuntimeError("could not build a wait question")


def _with_reds(rng: random.Random, tiles: list[str]) -> list[str]:
    """Turn some fives red (at most one per suit)."""
    out = list(tiles)
    for red in AKA:
        idx = [i for i, t in enumerate(out) if t == red[:2]]
        if idx and rng.random() < 0.35:
            out[rng.choice(idx)] = red
    return out


def score_question(rng: random.Random) -> dict:
    """A winning hand with its situation, and the full answer (han / fu / yaku / payment)."""
    for _ in range(1000):
        one_suit = rng.random() < 0.2
        suits = (rng.choice(_SUITS),) if one_suit else _SUITS
        built = _complete_hand(rng, suits, honors=rng.random() < 0.6)
        if not built:
            continue
        groups, pair = built
        n_open = rng.choice((0, 0, 0, 1, 1, 2))
        called = rng.sample(range(4), n_open)
        melds = []
        for i in called:
            g = groups[i]
            kind_ = "pon" if g[0] == g[1] else "chi"
            tiles = _tiles(g)
            melds.append({"type": kind_, "tiles": tiles, "called": rng.randrange(3)})
        closed_kinds = [k for i, g in enumerate(groups) if i not in called for k in g] + pair
        concealed = _with_reds(rng, _tiles(closed_kinds))
        # with red fives in the set, a hand holding all four fives of a suit has the red one
        for red in AKA:
            all_now = concealed + [t for m in melds for t in m["tiles"]]
            if all_now.count(red[:2]) == 4:
                where = concealed if red[:2] in concealed else next(m["tiles"] for m in melds if red[:2] in m["tiles"])
                where[where.index(red[:2])] = red
        win = rng.choice(concealed)
        rest = list(concealed)
        rest.remove(win)

        tsumo = rng.random() < 0.4
        closed = n_open == 0
        riichi = closed and rng.random() < 0.6
        oya = rng.random() < 0.3
        jikaze = "E" if oya else rng.choice(("S", "W", "N"))
        bakaze = rng.choice(("E", "E", "S"))
        held = to_34(concealed + [t for m in melds for t in m["tiles"]])
        marker = rng.choice([k for k in KINDS if held[KINDS.index(k)] < 4])

        all_tiles = concealed + [t for m in melds for t in m["tiles"]]
        ids = to_136(all_tiles)
        win_id = ids[concealed.index(win)]
        lib_melds, pos = [], len(concealed)
        for m in melds:
            lib_melds.append(LibMeld(LibMeld.PON if m["type"] == "pon" else LibMeld.CHI, sorted(ids[pos : pos + 3]), opened=True))
            pos += 3
        used = set(ids)
        marker_id = next(i for i in range(KINDS.index(marker) * 4, KINDS.index(marker) * 4 + 4) if i not in used)
        res = HandCalculator.estimate_hand_value(
            ids,
            win_id,
            melds=lib_melds,
            dora_indicators=[marker_id],
            config=HandConfig(
                is_tsumo=tsumo,
                is_riichi=riichi,
                player_wind=27 + WINDS.index(jikaze),
                round_wind=27 + WINDS.index(bakaze),
                options=_OPTIONS,
            ),
        )
        if res.error or res.han >= 13:  # no yaku, or yakuman (not a useful counting exercise)
            continue
        main, additional = res.cost["main"], res.cost["additional"]
        if not tsumo:
            pay = {"ron": main}
        elif oya:
            pay = {"all": main}
        else:
            pay = {"ko": additional, "oya": main}
        return {
            "hand": rest,
            "win": win,
            "melds": melds,
            "tsumo": tsumo,
            "riichi": riichi,
            "oya": oya,
            "bakaze": bakaze,
            "jikaze": jikaze,
            "dora_markers": [marker],
            "answer": {
                "han": res.han,
                "fu": res.fu,
                "yaku": [(y.name, y.han_open if not closed else y.han_closed) for y in res.yaku],
                "fu_details": res.fu_details,
                "pay": pay,
                "total": main if not tsumo else (main * 3 if oya else main + additional * 2),
            },
        }
    raise RuntimeError("could not build a score question")
