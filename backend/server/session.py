"""One human (seat 0) vs three bots, driven over a WebSocket.

The session runs the engine generator in an asyncio task. Bot inference runs
in a worker thread. Every message sent to the client is kept in ``history``,
so a reconnecting client gets the full stream again and rebuilds its table.

Server -> client messages:
    {"type": "event", "event": <masked mjai event>, "actions": [...], "hint": [...]}
        ``actions`` / ``hint`` only when the human must decide now.
    {"type": "error", "message": str, "fatal": bool}
    {"type": "saved", "path": str}          after end_game
Client -> server:
    {"type": "action", "action": <one of the offered actions>}
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from fastapi import WebSocket

from backend import mortal
from backend.agents.mortal_agent import MortalAgent
from backend.agents.simple_agent import SimpleAgent
from backend.engine.actions import legal_actions
from backend.engine.game import Game, mask_event
from backend.engine.replay import write_log
from backend.engine.rules import Rules

log = logging.getLogger(__name__)

HUMAN = 0
BOT_NAMES = ["Mortal-A", "Mortal-B", "Mortal-C"]


def _key(action: dict) -> str:
    return json.dumps({k: v for k, v in action.items() if k != "meta"}, sort_keys=True)


class GameSession:
    def __init__(
        self,
        game_id: str,
        rules: Rules,
        *,
        seed: int | None = None,
        bots: str = "mortal",
        hints: bool = True,
        player_name: str = "You",
        log_dir: Path = Path("data/games"),
    ):
        self.id = game_id
        self.game = Game(rules, seed=seed, names=[player_name, *BOT_NAMES])
        self.bot_kind = bots
        self.hints = hints
        self.log_dir = log_dir
        self.history: list[dict] = []
        self.pending: dict | None = None  # the message awaiting the human's action
        self.finished = False
        self._ws: WebSocket | None = None
        self._actions: asyncio.Queue[dict] = asyncio.Queue()
        self._task: asyncio.Task | None = None

    # -- connection --------------------------------------------------------

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def attach(self, ws: WebSocket) -> None:
        """Make ``ws`` the client and replay everything sent so far."""
        self._ws = None
        sent = 0
        while sent < len(self.history):  # the game may append while we replay
            msg = self.history[sent]
            out = msg if msg is self.pending else {k: v for k, v in msg.items() if k not in ("actions", "hint")}
            await ws.send_json({**out, "replay": msg is not self.pending})
            sent += 1
        self._ws = ws  # no await since the loop's last check: nothing can slip in between

    def detach(self, ws: WebSocket) -> None:
        if self._ws is ws:
            self._ws = None

    async def submit(self, action: dict) -> None:
        await self._actions.put(action)

    async def _send(self, msg: dict, record: bool = True) -> None:
        if record:
            self.history.append(msg)
        if self._ws is not None:
            try:
                await self._ws.send_json(msg)
            except Exception:  # client went away; it will get the history on reconnect
                self._ws = None

    # -- game loop ---------------------------------------------------------

    def _make_agents(self) -> tuple[dict[int, Any], MortalAgent | None]:
        if self.bot_kind == "simple":
            bots = {s: SimpleAgent(s, seed=self.game.seed + s) for s in (1, 2, 3)}
        else:
            bots = {s: MortalAgent(s) for s in (1, 2, 3)}
        # A shadow Mortal in the human's seat provides hints.
        shadow = MortalAgent(HUMAN) if self.hints else None
        return bots, shadow

    async def _run(self) -> None:
        try:
            bots, shadow = await asyncio.to_thread(self._make_agents)
            gen = self.game.play()
            prompt = next(gen)
            while True:
                ev, need = prompt.event, prompt.need

                def react() -> tuple[dict[int, Any], dict | None]:
                    outs = {s: bot.react(mask_event(ev, s)) for s, bot in bots.items()}
                    return outs, shadow.react(mask_event(ev, HUMAN)) if shadow else None

                outs, shadow_out = await asyncio.to_thread(react)
                actions = {s: outs[s] for s in need if s != HUMAN}

                msg: dict = {"type": "event", "event": mask_event(ev, HUMAN)}
                if HUMAN in need:
                    legal = legal_actions(self.game._refs[HUMAN], need[HUMAN], self.game.state, HUMAN, ev)
                    msg["actions"] = legal
                    if shadow_out and shadow_out.get("meta"):
                        msg["hint"] = mortal.top_actions(shadow_out["meta"], self.game._refs[HUMAN])
                    self.pending = msg
                    await self._send(msg)
                    actions[HUMAN] = await self._wait_human(legal)
                    self.pending = None
                else:
                    await self._send(msg)

                try:
                    prompt = gen.send(actions)
                except StopIteration:
                    break
            path = self.log_dir / f"{self.id}.json.gz"
            await asyncio.to_thread(write_log, path, self.game.log)
            self.finished = True
            await self._send({"type": "saved", "path": str(path)})
        except Exception as ex:
            log.exception("game %s crashed", self.id)
            await self._send({"type": "error", "message": f"{type(ex).__name__}: {ex}", "fatal": True})

    async def _wait_human(self, legal: list[dict]) -> dict:
        allowed = {_key(a): a for a in legal}
        while True:
            action = await self._actions.get()
            if _key(action) in allowed:
                return allowed[_key(action)]
            await self._send({"type": "error", "message": f"illegal action: {action}", "fatal": False}, record=False)
