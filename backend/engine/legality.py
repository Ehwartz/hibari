"""Discard rules that libriichi's ``validate_reaction`` does not enforce.

``validate_reaction`` only checks that a discarded tile is in the hand; it
accepts any discard after riichi and riichi declarations that break tenpai
(Mortal never tries those, so its arena never needed the checks). The engine
and ``legal_actions`` both run discards through ``discard_error``.
"""
from __future__ import annotations

from backend.engine.scoring import waits
from backend.engine.state import KyokuState, SeatState
from backend.engine.tiles import kind


def kuikae_kinds(call: dict) -> set[int]:
    """Kinds that may not be discarded right after this chi / pon (Tenhou: no kuikae)."""
    k = kind(call["pai"])
    forbidden = {k}
    if call["type"] == "chi":
        consumed = sorted(kind(t) for t in call["consumed"])
        if k < consumed[0] and k % 9 <= 5:  # called the low end of e.g. 3-4-5 -> no 6
            forbidden.add(k + 3)
        if k > consumed[-1] and k % 9 >= 3:  # called the high end -> no suji below
            forbidden.add(k - 3)
    return forbidden


def discard_error(st: KyokuState, seat: int, action: dict, event: dict) -> str | None:
    """Why ``action`` (a dahai) is illegal as a reply to ``event``, or None.

    ``st`` has already applied ``event`` (the event the seat is replying to).
    """
    s = st.seats[seat]
    pai, tsumogiri = action["pai"], action.get("tsumogiri", False)
    own_draw = event["type"] == "tsumo" and event["actor"] == seat
    # the riichi declaration discard replies to the reach event, but the drawn tile is still the one
    # just drawn (draw -> reach -> dahai): discarding it is a tsumogiri too
    just_drawn = st.last_tsumo[1] if st.last_tsumo and st.last_tsumo[0] == seat else None
    after_own_reach = event["type"] == "reach" and event["actor"] == seat
    if tsumogiri and not ((own_draw or after_own_reach) and pai == just_drawn):
        return "tsumogiri of a tile that was not just drawn"
    if s.riichi_accepted:
        if not (own_draw and tsumogiri and pai == event["pai"]):
            return "after riichi only the drawn tile can be discarded"
        return None
    if event["type"] == "reach" and event["actor"] == seat:
        rest = list(s.hand)
        rest.remove(pai)
        if not waits(SeatState(hand=rest, melds=s.melds)):
            return "riichi discard must keep the hand tenpai"
    if event["type"] in ("chi", "pon") and event["actor"] == seat and kind(pai) in kuikae_kinds(event):
        return "kuikae (swap-calling) is not allowed"
    return None
