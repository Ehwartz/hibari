"""Engine self-play: 4 agents play full games through backend.engine.

    uv run python -m scripts.selfplay --agent mortal --games 2
    uv run python -m scripts.selfplay --agent simple --games 500

Logs go to ``--log-dir`` as mjai ``.json.gz``; every log is re-scored with
the replayer and summarised with ``libriichi.stat.Stat``.
"""
from __future__ import annotations

import argparse
import collections
import time
from pathlib import Path

from backend import mortal
from backend.agents.mortal_agent import MortalAgent
from backend.agents.simple_agent import SimpleAgent
from backend.engine.driver import run_game
from backend.engine.game import Game
from backend.engine.replay import check_log, write_log
from backend.engine.rules import Rules


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--agent", choices=["mortal", "simple"], default="mortal")
    ap.add_argument("--games", type=int, default=1)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--length", choices=["hanchan", "tonpuu"], default="hanchan")
    ap.add_argument("--log-dir", default=None)
    args = ap.parse_args()

    log_dir = Path(args.log_dir or f"data/selfplay/{args.agent}")
    rules = Rules(length=args.length)
    names = [f"{args.agent}{i}" for i in range(4)]
    outcomes = collections.Counter()
    rank_sum = [0] * 4
    t0 = time.perf_counter()
    for g in range(args.games):
        seed = args.seed + g
        if args.agent == "mortal":
            agents = [MortalAgent(i) for i in range(4)]
        else:
            agents = [SimpleAgent(i, seed=seed * 4 + i) for i in range(4)]
        game = run_game(Game(rules, seed=seed, names=names), agents)
        write_log(log_dir / f"{seed}.json.gz", game.log)
        mismatches = check_log(game.log)
        assert not mismatches, mismatches
        assert sum(game.scores) == 4 * rules.start_points, game.scores
        for r in game.results:
            outcomes[r.reason or r.kind] += 1
        for s in range(4):
            rank_sum[s] += game.ranks[s]
        print(f"game {seed}: scores={game.scores} ranks={game.ranks} kyoku={len(game.results)}", flush=True)

    dt = time.perf_counter() - t0
    print(f"\n{args.games} games in {dt:.1f}s ({dt / args.games:.1f}s/game)")
    print("outcomes:", dict(outcomes))
    print("avg rank by seat:", [round(r / args.games, 2) for r in rank_sum])
    stat = mortal.libriichi().stat.Stat.from_dir(str(log_dir), names[0])
    print(
        f"seat-0 stats (libriichi): games={stat.game} agari={stat.agari_rate:.3f} "
        f"houjuu={stat.houjuu_rate:.3f} riichi={stat.riichi_rate:.3f} fuuro={stat.fuuro_rate:.3f}"
    )


if __name__ == "__main__":
    main()
