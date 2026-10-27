"""M0 smoke test: Mortal x4 self-play via libriichi's Rust arena.

Writes reference mjai logs (useful for validating our own engine in M1) and
prints libriichi stats for seat 0.

    uv run python -m scripts.m0_smoke --seeds 1
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

from backend import mortal


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=1, help="each seed plays 4 hanchan (seat rotations)")
    ap.add_argument("--seed-start", type=int, default=10000)
    ap.add_argument("--log-dir", default="data/reference_logs")
    args = ap.parse_args()

    lib = mortal.libriichi()
    engine = mortal.get_engine()
    print(f"device: {engine.device}")

    log_dir = Path(args.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    arena = lib.arena.OneVsThree(disable_progress_bar=False, log_dir=str(log_dir))

    t0 = time.perf_counter()
    rankings = arena.py_vs_py(engine, engine, (args.seed_start, 0), args.seeds)
    dt = time.perf_counter() - t0
    print(f"{args.seeds * 4} hanchan in {dt:.1f}s; challenger rank counts: {rankings}")

    stat = lib.stat.Stat.from_dir(str(log_dir), "mortal")
    print(
        f"games={stat.game} rounds={stat.round} avg_rank={stat.avg_rank:.2f} "
        f"agari_rate={stat.agari_rate:.3f} houjuu_rate={stat.houjuu_rate:.3f} "
        f"riichi_rate={stat.riichi_rate:.3f} fuuro_rate={stat.fuuro_rate:.3f}"
    )


if __name__ == "__main__":
    main()
