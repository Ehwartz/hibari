"""Export one Mortal x4 game as UI mock data (frontend/src/mock/game.json).

Each entry is a full (unmasked) event plus, when seat 0 may act, its concrete
legal actions and the action Mortal chose (with q_values meta, for the hint
panel). Also checks that every chosen action is in the enumerated list.

    uv run python -m scripts.export_mock --seed 3
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from backend import mortal
from backend.agents.mortal_agent import MortalAgent
from backend.engine.actions import legal_actions
from backend.engine.game import Game, mask_event
from backend.engine.rules import Rules

OUT = Path(__file__).resolve().parents[1] / "frontend" / "src" / "mock" / "game.json"


def _key(a: dict) -> str:
    return json.dumps({k: v for k, v in a.items() if k != "meta"}, sort_keys=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--length", choices=["hanchan", "tonpuu"], default="tonpuu")
    args = ap.parse_args()

    names = ["You", "Mortal-A", "Mortal-B", "Mortal-C"]
    game = Game(Rules(length=args.length), seed=args.seed, names=names)
    agents = [MortalAgent(i) for i in range(4)]
    frames, checked = [], 0
    gen = game.play()
    prompt = next(gen)
    while True:
        actions = {}
        legal = {}
        for seat in prompt.need:
            legal[seat] = legal_actions(game._refs[seat], prompt.need[seat], game.state, seat, prompt.event)
        for seat, agent in enumerate(agents):
            out = agent.react(mask_event(prompt.event, seat))
            if seat in prompt.need:
                actions[seat] = out
                chosen = out or {"type": "none"}
                assert _key(chosen) in {_key(a) for a in legal[seat]}, (chosen, legal[seat])
                checked += 1
        frame = {"event": prompt.event}
        if 0 in prompt.need:
            frame["actions"] = legal[0]
            frame["chosen"] = {k: v for k, v in (actions[0] or {"type": "none"}).items() if k != "meta"}
            meta = (actions[0] or {}).get("meta")
            if meta:
                frame["hint"] = mortal.top_actions(meta, game._refs[0])
        frames.append(frame)
        try:
            prompt = gen.send(actions)
        except StopIteration:
            break

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"names": names, "frames": frames}, ensure_ascii=False), encoding="utf-8")
    print(f"{len(frames)} frames, {checked} decisions checked against legal_actions -> {OUT}")
    print("scores", game.scores, "kyoku", [(r.bakaze, r.kyoku, r.kind) for r in game.results])


if __name__ == "__main__":
    main()
