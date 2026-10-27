from __future__ import annotations

import random

from backend.engine.tiles import full_set

DEAD_WALL = 14


class Wall:
    """Shuffled 136 tiles: live wall + 14-tile dead wall.

    Dead wall layout: 5 dora indicators, 5 ura indicators, 4 rinshan tiles.
    The live/rinshan draw count limit (70 total) is tracked by ``KyokuState``.
    """

    def __init__(self, rng: random.Random, aka: bool = True):
        tiles = full_set(aka)
        rng.shuffle(tiles)
        self.live = tiles[:-DEAD_WALL]
        dead = tiles[-DEAD_WALL:]
        self._dora = dead[0:5]
        self._ura = dead[5:10]
        self._rinshan = dead[10:14]
        self._live_pos = 0
        self._rinshan_pos = 0
        self.revealed = 1

    def deal(self, oya: int) -> list[list[str]]:
        hands: list[list[str]] = [[] for _ in range(4)]
        for i in range(4):
            seat = (oya + i) % 4
            hands[seat] = self.live[self._live_pos : self._live_pos + 13]
            self._live_pos += 13
        return hands

    def draw(self) -> str:
        tile = self.live[self._live_pos]
        self._live_pos += 1
        return tile

    def draw_rinshan(self) -> str:
        tile = self._rinshan[self._rinshan_pos]
        self._rinshan_pos += 1
        return tile

    def reveal_dora(self) -> str:
        marker = self._dora[self.revealed]
        self.revealed += 1
        return marker

    @property
    def dora_markers(self) -> list[str]:
        return self._dora[: self.revealed]

    @property
    def ura_markers(self) -> list[str]:
        return self._ura[: self.revealed]
