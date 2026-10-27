"""Replay full mjai logs through ``KyokuState`` and re-score every outcome.

Used to cross-check our scoring against logs produced by other engines
(libriichi's arena) and, later, to rebuild per-kyoku results for review.
"""
from __future__ import annotations

import gzip
import json
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

from backend.engine.scoring import HoraResult, evaluate_hora, exhaustive_draw_deltas
from backend.engine.state import KyokuState


@dataclass
class Mismatch:
    kyoku: str
    event: dict
    expected: list[int]
    got: list[int]
    detail: str = ""


def read_log(path: str | Path) -> list[dict]:
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_log(path: str | Path, events: Iterable[dict]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "wt", encoding="utf-8") as f:
        for ev in events:
            f.write(json.dumps(ev, separators=(",", ":"), ensure_ascii=False) + "\n")


def replay(events: Iterable[dict]) -> Iterator[tuple[KyokuState, dict, HoraResult | list[int] | None]]:
    """Yield (state before event, event, our result) for each hora / ryukyoku."""
    st: KyokuState | None = None
    for ev in events:
        t = ev["type"]
        if t == "start_kyoku":
            st = KyokuState(ev)
            continue
        if st is None:
            continue
        if t == "hora":
            yield st, ev, evaluate_hora(st, ev["actor"], ev["target"], ev.get("ura_markers", []))
        elif t == "ryukyoku":
            ours = exhaustive_draw_deltas(st)[0] if st.tiles_left == 0 else [0, 0, 0, 0]
            yield st, ev, ours
        st.apply(ev)


def check_log(events: Iterable[dict]) -> list[Mismatch]:
    out = []
    for st, ev, res in replay(events):
        got = res.deltas if isinstance(res, HoraResult) else res
        if got != ev["deltas"]:
            detail = ""
            if isinstance(res, HoraResult):
                detail = f"han={res.han} fu={res.fu} yaku={res.yaku} hand={st.seats[res.actor].hand}"
            out.append(Mismatch(f"{st.bakaze}{st.kyoku}-{st.honba}", ev, ev["deltas"], got, detail))
    return out
