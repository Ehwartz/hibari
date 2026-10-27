"""Mortal review of a saved game, from the human's seat.

The log is replayed (masked for the human's seat) into a greedy Mortal bot.
At every point where the human had a decision, Mortal's q-values are turned
into probabilities over the legal actions (softmax, T = 0.3 like the hint
panel) and compared with what the human actually did.

Action labels follow Mortal's action space: tiles ``1m``..``C`` and red fives
``5mr`` / ``5pr`` / ``5sr`` for discards, then ``reach``, ``chi_low``,
``chi_mid``, ``chi_high``, ``pon``, ``kan_select``, ``hora``, ``ryukyoku``,
``none``.
"""
from __future__ import annotations

import math
from typing import Any

from backend import mortal
from backend.agents.mortal_agent import MortalAgent
from backend.engine.game import mask_event
from backend.engine.tiles import kind

REVIEW_VERSION = 1
TEMPERATURE = 0.3
# a decision counts as a "bad move" when Mortal gave the actual action less than this
BAD_PROB = 0.05

_SKIP = {"dora", "reach_accepted"}
_ACTION_TYPES = {"dahai", "reach", "chi", "pon", "daiminkan", "ankan", "kakan", "hora", "ryukyoku"}


def _labels() -> list[str]:
    mortal._model_module()
    import meta_show

    return meta_show.ACTION_LABELS_4P


def _probs(meta: dict) -> tuple[dict[str, float], dict[str, float]]:
    labels = _labels()
    mask, q = int(meta["mask_bits"]), [float(v) for v in meta["q_values"]]
    legal = [labels[i] for i in range(len(labels)) if (mask >> i) & 1][: len(q)]
    top = max(q)
    exps = [math.exp((v - top) / TEMPERATURE) for v in q]
    total = sum(exps)
    return {l: e / total for l, e in zip(legal, exps)}, dict(zip(legal, q))


def action_label(ev: dict) -> str:
    """Mortal action label of an mjai action event."""
    t = ev["type"]
    if t == "dahai":
        return ev["pai"]
    if t == "chi":
        k, used = kind(ev["pai"]), [kind(c) for c in ev["consumed"]]
        return "chi_low" if k < min(used) else "chi_high" if k > max(used) else "chi_mid"
    if t in ("daiminkan", "ankan", "kakan"):
        return "kan_select"
    return t  # reach, pon, hora, ryukyoku


def actual_action(events: list[dict], i: int, seat: int) -> dict:
    """What ``seat`` did in reply to ``events[i]`` (``{"type": "none"}`` if it passed)."""
    for ev in events[i + 1 :]:
        t = ev["type"]
        if t in _SKIP or (t == "hora" and ev["actor"] != seat):
            continue
        if ev.get("actor") == seat and t in _ACTION_TYPES:
            return ev
        return {"type": "none"}
    return {"type": "none"}


def review_game(events: list[dict]) -> dict[str, Any]:
    start = events[0]
    seat = int(start.get("human", 0))
    bot = MortalAgent(seat)
    decisions = []
    for i, ev in enumerate(events):
        out = bot.react(mask_event(ev, seat))
        if not out or not out.get("meta") or "q_values" not in out["meta"]:
            continue
        probs, q = _probs(out["meta"])
        actual = actual_action(events, i, seat)
        actual_label = "none" if actual["type"] == "none" else action_label(actual)
        best = max(probs, key=probs.get)
        decisions.append(
            {
                "index": i,  # the event the decision replies to
                "probs": {k: round(v, 4) for k, v in probs.items()},
                "q": {k: round(v, 4) for k, v in q.items()},
                "best": best,
                "actual": actual_label,
                "actual_prob": round(probs.get(actual_label, 0.0), 4),
                "match": actual_label == best,
                "discard": ev["type"] in ("tsumo", "reach", "chi", "pon") and ev.get("actor") == seat,
            }
        )
    n = len(decisions)
    matches = sum(d["match"] for d in decisions)
    bad = sum(d["actual_prob"] < BAD_PROB for d in decisions)
    return {
        "version": REVIEW_VERSION,
        "human": seat,
        "temperature": TEMPERATURE,
        "summary": {"decisions": n, "matches": matches, "rate": round(matches / n, 4) if n else None, "bad": bad},
        "decisions": decisions,
    }
