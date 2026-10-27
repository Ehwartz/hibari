from __future__ import annotations

from typing import Protocol


class Agent(Protocol):
    """One mjai event in, maybe an action out.

    ``event`` is already masked for the agent's seat. The return value is an
    mjai action dict when the agent decides to act, otherwise ``None``.
    """

    seat: int

    def react(self, event: dict) -> dict | None: ...
