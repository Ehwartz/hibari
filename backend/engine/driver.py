from __future__ import annotations

from collections.abc import Sequence

from backend.agents.base import Agent
from backend.engine.game import Game, mask_event


def run_game(game: Game, agents: Sequence[Agent]) -> Game:
    """Play ``game`` to the end with synchronous agents (self-play, tests)."""
    gen = game.play()
    prompt = next(gen)
    while True:
        actions = {}
        for seat, agent in enumerate(agents):
            out = agent.react(mask_event(prompt.event, seat))
            if seat in prompt.need:
                actions[seat] = out
        try:
            prompt = gen.send(actions)
        except StopIteration:
            return game
