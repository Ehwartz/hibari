from __future__ import annotations

import json

from backend import mortal


class MortalAgent:
    def __init__(self, seat: int):
        self.seat = seat
        self._bot = mortal.load_bot(seat)

    def react(self, event: dict) -> dict | None:
        if event["type"] == "start_game" and event["id"] != self.seat:
            raise ValueError(f"start_game id {event['id']} != seat {self.seat}")
        out = self._bot.react(json.dumps(event, separators=(",", ":")))
        return json.loads(out) if out else None
