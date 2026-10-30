"""Head-to-head strength test of two Mortal checkpoints: 1v3 in both directions.

    python compare.py --a runs/x/baseline.pth --b ../hf/other.pth --games 20000 [--name x_vs_y] [--device cuda:0]

Each direction plays --games hanchans with one checkpoint against three of the other (every seed in all
four seat rotations), through Mortal's one_vs_three.py. Prints the rank counts, the average rank with its
standard error, and the score under each style's points; 2.5 / 0 mean equal strength. Files and logs go to
runs/compare/<name>/. A direction already finished (its result.json exists) is not played again.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
import time
from pathlib import Path

import make_config
from pilot import HERE, MORTAL, mortal_env


def play(work: Path, challenger: Path, champion: Path, games: int, device: str, amp: bool) -> dict:
    result = work / "result.json"
    if result.exists():
        return json.loads(result.read_text(encoding="utf-8"))
    work.mkdir(parents=True, exist_ok=True)
    make_config.SCALES["full"].update(games_1v3=games)
    cfg = make_config.config_text(work, "balance", "full", device, amp, 5099)
    for section, path in (("challenger", challenger), ("champion", champion)):
        cfg, n = re.subn(rf"(\[1v3\.{section}\][^\[]*?state_file = )'[^']*'", rf"\g<1>'{path.resolve().as_posix()}'", cfg, flags=re.S)
        if n != 1:
            raise SystemExit(f"no [1v3.{section}] state_file in the config")
    (work / "config.toml").write_text(cfg, encoding="utf-8")

    env = {**mortal_env(), "MORTAL_CFG": str(work / "config.toml")}
    start = time.time()
    with open(work / "1v3.log", "w", encoding="utf-8") as log:
        subprocess.run([sys.executable, "one_vs_three.py"], cwd=MORTAL, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
    found = re.findall(r"challenger rankings: \[([\d\s]+)\]", (work / "1v3.log").read_text(encoding="utf-8", errors="replace"))
    if not found:
        raise SystemExit(f"no result in {work / '1v3.log'}")
    out = {"ranks": [int(x) for x in found[-1].split()], "seconds": round(time.time() - start)}
    result.write_text(json.dumps(out), encoding="utf-8")
    return out


def report(label: str, r: dict) -> str:
    cs = r["ranks"]
    n = sum(cs)
    avg = sum((i + 1) * c for i, c in enumerate(cs)) / n
    var = sum(((i + 1) - avg) ** 2 * c for i, c in enumerate(cs)) / n
    rates = "  ".join(f"{k} {c / n:6.2%}" for k, c in zip(("1st", "2nd", "3rd", "4th"), cs))
    scores = "  ".join(f"{s} {sum((p - sum(pts) / 4) * c for p, c in zip(pts, cs)) / n:+.3f}" for s, pts in make_config.STYLES.items())
    return (f"{label}\n  {n} games in {r['seconds']} s ({n / max(1, r['seconds']) * 3600:,.0f}/h)  {rates}\n"
            f"  avg rank {avg:.4f} ± {math.sqrt(var / n):.4f}  score: {scores}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", type=Path, required=True)
    ap.add_argument("--b", type=Path, required=True)
    ap.add_argument("--games", type=int, default=20000, help="hanchans per direction (rounded down to a multiple of 4)")
    ap.add_argument("--name", default="")
    ap.add_argument("--device", default="cuda:0")
    args = ap.parse_args()

    name = args.name or f"{args.a.stem}_vs_{args.b.stem}_{args.games}"
    root = HERE / "runs" / "compare" / name
    amp = args.device.startswith("cuda")
    ab = play(root / "a_vs_3b", args.a, args.b, args.games, args.device, amp)
    print(report(f"one {args.a.name} against three {args.b.name}", ab), flush=True)
    ba = play(root / "b_vs_3a", args.b, args.a, args.games, args.device, amp)
    print(report(f"one {args.b.name} against three {args.a.name}", ba), flush=True)


if __name__ == "__main__":
    main()
