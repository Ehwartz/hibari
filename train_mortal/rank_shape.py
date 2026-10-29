"""Rank shape of the trainee from the self-play client logs: does a run's `pts` change the style?

    python rank_shape.py runs/ctl_a runs/ctl_b [--bucket-hours 2] [--skip-hours 2]

Each client logs `trainee rankings: [n1 n2 n3 n4]` after every round. The games are played in all
four seat rotations of each seed, so a trainee as strong as the baseline sits at 25 % per rank; a
style shows up as the shape: more 1st and 4th (risky) or more 2nd and 3rd (safe). Prints the rates
per time bucket, then per run (after --skip-hours) the share of 1st + 4th and the average score
under each style's points. These are training games (Boltzmann exploration on), fine for
comparing runs played with the same settings.
"""
from __future__ import annotations

import argparse
import math
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import make_config

LINE = re.compile(r"^(\S+ \S+),\d+ .*trainee rankings: \[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\]")


def rounds(run: Path) -> list[tuple[datetime, list[int]]]:
    out = []
    for log in sorted((run / "logs").glob("client*.log")):
        for line in log.read_text(encoding="utf-8", errors="replace").replace("\r", "\n").splitlines():
            if m := LINE.match(line):
                out.append((datetime.strptime(m[1], "%Y-%m-%d %H:%M:%S"), [int(m[i]) for i in range(2, 6)]))
    return sorted(out)


def total(rs) -> list[int]:
    return [sum(cs[i] for _, cs in rs) for i in range(4)]


def rates(label: str, cs: list[int]) -> str:
    n = sum(cs)
    avg = sum((i + 1) * c for i, c in enumerate(cs)) / n
    shares = "  ".join(f"{k} {c / n:6.2%}" for k, c in zip(("1st", "2nd", "3rd", "4th"), cs))
    return f"  {label:<10} n={n:7d}  {shares}  (±{math.sqrt(0.1875 / n):.2%})  avg rank {avg:.3f}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", type=Path, nargs="+")
    ap.add_argument("--bucket-hours", type=float, default=2)
    ap.add_argument("--skip-hours", type=float, default=2, help="left out of the summary (the trainee still equals the baseline)")
    args = ap.parse_args()

    summary = []
    for run in args.runs:
        rs = rounds(run)
        if not rs:
            print(f"{run}: no rounds logged")
            continue
        t0 = rs[0][0]
        hours = lambda t: (t - t0).total_seconds() / 3600
        print(run.name)
        buckets = defaultdict(list)
        for r in rs:
            buckets[int(hours(r[0]) // args.bucket_hours)].append(r)
        for b in sorted(buckets):
            print(rates(f"{b * args.bucket_hours:g}-{(b + 1) * args.bucket_hours:g} h", total(buckets[b])))
        print(rates("all", total(rs)))
        late = total([r for r in rs if hours(r[0]) >= args.skip_hours]) or total(rs)
        summary.append((run.name, late))

    # scores relative to an equal trainee (25 % each); `top` points do not sum to zero
    print(f"\nafter the first {args.skip_hours:g} h (score 0 = same as the baseline):")
    for name, cs in summary:
        n = sum(cs)
        scores = "  ".join(f"{style} {sum((p - sum(pts) / 4) * c for p, c in zip(pts, cs)) / n:+.4f}"
                           for style, pts in make_config.STYLES.items())
        print(f"  {name:<10} 1st+4th {(cs[0] + cs[3]) / n:6.2%}  score with pts of: {scores}")


if __name__ == "__main__":
    main()
