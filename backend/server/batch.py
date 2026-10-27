"""Batch AI 代打: Mortal plays the human's seat for N games, as fast as possible, to build up logs."""
from __future__ import annotations

import asyncio
import logging
import random
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime

from backend import storage
from backend.agents.mortal_agent import MortalAgent
from backend.engine.driver import run_game
from backend.engine.game import Game
from backend.engine.replay import write_log
from backend.engine.rules import Rules
from backend.server.session import BOT_IDS, assign_seats

log = logging.getLogger(__name__)


@dataclass
class BatchStatus:
    running: bool = False
    length: str = "hanchan"
    total: int = 0
    done: int = 0
    current: str | None = None
    games: list[str] = field(default_factory=list)
    error: str | None = None
    cancelled: bool = False


status = BatchStatus()
_task: asyncio.Task | None = None


def play_one(settings: storage.Settings, length: str) -> str:
    rng = random.Random()
    human, players = assign_seats(rng)
    temps = dict(zip(BOT_IDS, settings.bot_temps))
    names_by_id = dict(zip(BOT_IDS, settings.bot_names))
    names = [settings.player_name if p == "human" else names_by_id[p] for p in players]
    meta = {
        "started_at": datetime.now().isoformat(timespec="seconds"),
        "length": length,
        "human": human,
        "players": players,
        "temperatures": {names_by_id[b]: t for b, t in temps.items()},
        "autoplay": "full",
        "auto_temp": settings.auto_temp,
    }
    agents = [
        MortalAgent(s, settings.auto_temp if p == "human" else temps[p]) for s, p in enumerate(players)
    ]
    game_id = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    game = run_game(Game(Rules(length=length), names=names, meta=meta), agents)
    write_log(settings.log_path / f"{game_id}.json.gz", game.log)
    return game_id


async def _run(length: str, count: int) -> None:
    global status
    try:
        for _ in range(count):
            if status.cancelled:
                break
            settings = storage.load_settings()
            status.current = f"{status.done + 1}/{count}"
            game_id = await asyncio.to_thread(play_one, settings, length)
            status.games.append(game_id)
            status.done += 1
    except Exception as ex:  # keep the error for the UI
        log.exception("batch autoplay failed")
        status.error = f"{type(ex).__name__}: {ex}"
    finally:
        status.running = False
        status.current = None


def start(length: str, count: int) -> BatchStatus:
    global status, _task
    if status.running:
        raise RuntimeError("a batch is already running")
    status = BatchStatus(running=True, length=length, total=count)
    _task = asyncio.create_task(_run(length, count))
    return status


def cancel() -> BatchStatus:
    status.cancelled = True
    return status


def snapshot() -> dict:
    return asdict(status)
