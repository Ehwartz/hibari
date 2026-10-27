from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class Rules:
    """Game-level rule options.

    Hand-level rules (red fives, kuitan, atozuke, furiten, kuikae, …) follow
    Tenhou and are enforced by libriichi's ``PlayerState``; they are not
    configurable here.
    """

    length: Literal["tonpuu", "hanchan"] = "hanchan"
    start_points: int = 25000
    # Points needed to end the game in all-last; also the "return" for final pt.
    target_points: int = 30000
    uma: tuple[int, int, int, int] = (20, 10, -10, -20)
    # Game ends as soon as anyone drops below 0.
    tobi: bool = True
    # Dealer in all-last who is top (and >= target) after a win / tenpai ends the game.
    agari_yame: bool = True
    # Continue into the next wind (West for hanchan) if nobody reached target.
    extension: bool = True
    # Three simultaneous rons abort the hand (Tenhou).
    sanchahou_abort: bool = True
    aka: bool = True

    @property
    def last_round(self) -> int:
        """Index (wind * 4 + kyoku) of the regular all-last."""
        return 3 if self.length == "tonpuu" else 7

    @property
    def hard_last_round(self) -> int:
        return self.last_round + 4 if self.extension else self.last_round
