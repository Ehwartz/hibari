"""Enumerate the concrete legal actions of a seat (for the human's action bar).

libriichi's ``ActionCandidate`` only says *which kinds* of action are
possible; the UI needs concrete mjai actions (which tile to discard, which
two tiles to chi with, red five or not). We generate candidates from the
seat's hand and keep the ones the referee's ``validate_reaction`` accepts.
"""
from __future__ import annotations

import json
from itertools import combinations

from backend.engine.legality import discard_error
from backend.engine.state import KyokuState
from backend.engine.tiles import kind, sort_key


def _kind(t: str | int) -> int:
    return t if isinstance(t, int) else kind(t)


def _valid(ref, action: dict) -> bool:
    try:
        ref.validate_reaction(json.dumps(action, separators=(",", ":")))
        return True
    except Exception:
        return False


def _choices(hand: list[str], k: int, n: int) -> list[list[str]]:
    """Distinct ways to take ``n`` tiles of kind ``k`` from ``hand`` (red / plain fives differ)."""
    same = sorted((t for t in hand if kind(t) == k), key=sort_key)
    return [list(c) for c in sorted(set(combinations(same, n)))]


def legal_actions(ref, cans, st: KyokuState, seat: int, event: dict) -> list[dict]:
    hand = st.seats[seat].hand
    out: list[dict] = []
    if cans.can_tsumo_agari:
        out.append({"type": "hora", "actor": seat, "target": seat})
    if cans.can_ron_agari:
        out.append({"type": "hora", "actor": seat, "target": cans.target_actor})
    if cans.can_riichi:
        out.append({"type": "reach", "actor": seat})
    if cans.can_ryukyoku:
        out.append({"type": "ryukyoku", "actor": seat})
    if cans.can_ankan:
        # libriichi's candidates respect riichi (no wait-changing ankan)
        for k in sorted({_kind(t) for t in ref.ankan_candidates()}):
            for c in _choices(hand, k, 4):
                out.append({"type": "ankan", "actor": seat, "consumed": c})
    if cans.can_kakan:
        allowed = {_kind(t) for t in ref.kakan_candidates()}
        for m in st.seats[seat].melds:
            if m.type != "pon" or kind(m.pai) not in allowed:
                continue
            for t in {t for t in hand if kind(t) == kind(m.pai)}:
                out.append({"type": "kakan", "actor": seat, "pai": t, "consumed": m.consumed + [m.pai]})

    if event["type"] in ("dahai", "kakan", "ankan") and event["actor"] != seat:
        pai = event["pai"] if event["type"] != "ankan" else event["consumed"][0]
        k, target = kind(pai), event["actor"]
        call = {"actor": seat, "target": target, "pai": pai}
        if cans.can_daiminkan:
            out += [{"type": "daiminkan", **call, "consumed": c} for c in _choices(hand, k, 3)]
        if cans.can_pon:
            out += [{"type": "pon", **call, "consumed": c} for c in _choices(hand, k, 2)]
        if k < 27:
            for ok, offs in ((cans.can_chi_low, (1, 2)), (cans.can_chi_mid, (-1, 1)), (cans.can_chi_high, (-2, -1))):
                if not ok:
                    continue
                a = _choices(hand, k + offs[0], 1)
                b = _choices(hand, k + offs[1], 1)
                out += [{"type": "chi", **call, "consumed": x + y} for x in a for y in b]

    if cans.can_discard:
        # the tile just drawn: also right after declaring riichi (draw -> reach -> discard)
        replies_to_own = event["type"] in ("tsumo", "reach") and event["actor"] == seat
        drawn = st.last_tsumo[1] if replies_to_own and st.last_tsumo and st.last_tsumo[0] == seat else None
        for t in sorted(set(hand), key=sort_key):
            if t == drawn:
                out.append({"type": "dahai", "actor": seat, "pai": t, "tsumogiri": True})
                if hand.count(t) == 1:
                    continue
            out.append({"type": "dahai", "actor": seat, "pai": t, "tsumogiri": False})

    if cans.can_pass:
        out.append({"type": "none"})
    return [
        a
        for a in out
        if a["type"] == "none"
        or (_valid(ref, a) and not (a["type"] == "dahai" and discard_error(st, seat, a, event)))
    ]
