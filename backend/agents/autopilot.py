"""Mortal playing the human's seat (AI 代打), with an optional sampling temperature.

The session already runs a greedy "shadow" Mortal in the human's seat for
hints. Autopilot reuses its reaction: at temperature 0 it plays the shadow's
action as is; otherwise it samples a Mortal action label from
softmax(Q / T) over the legal actions and maps it to one of the concrete legal
actions offered to the human.
"""
from __future__ import annotations

import json
import math
import random

from backend.analysis.review import action_label
from backend.mortal import _model_module


def _key(action: dict) -> str:
    return json.dumps({k: v for k, v in action.items() if k != "meta"}, sort_keys=True)


def _label_probs(meta: dict, temperature: float) -> dict[str, float]:
    _model_module()
    import meta_show

    labels = meta_show.ACTION_LABELS_4P
    mask, q = int(meta["mask_bits"]), [float(v) for v in meta["q_values"]]
    legal = [labels[i] for i in range(len(labels)) if (mask >> i) & 1][: len(q)]
    top = max(q)
    exps = [math.exp((v - top) / temperature) for v in q]
    total = sum(exps)
    return {lab: e / total for lab, e in zip(legal, exps)}


def _for_label(label: str, legal: list[dict]) -> dict | None:
    """A concrete legal action for a Mortal label (prefers tsumogiri for the drawn tile)."""
    matches = [a for a in legal if (a["type"] == "none" and label == "none") or (a["type"] != "none" and action_label(a) == label)]
    if not matches:
        return None
    return next((a for a in matches if a.get("tsumogiri")), matches[0])


def autopilot_action(legal: list[dict], shadow_out: dict | None, temperature: float, rng: random.Random) -> dict:
    meta = (shadow_out or {}).get("meta") or {}
    allowed = {_key(a): a for a in legal}
    if temperature <= 0 or "q_values" not in meta:
        if shadow_out and _key(shadow_out) in allowed:
            return allowed[_key(shadow_out)]
    elif meta:
        probs = _label_probs(meta, temperature)
        labels = list(probs)
        for _ in range(3):  # a label without a concrete match (shouldn't happen) -> resample
            pick = _for_label(rng.choices(labels, weights=[probs[x] for x in labels])[0], legal)
            if pick:
                return pick
    # fallback: anything legal, preferring to pass / tsumogiri
    return next((a for a in legal if a["type"] == "none"), None) or next(
        (a for a in legal if a.get("tsumogiri")), legal[0]
    )
