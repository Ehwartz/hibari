"""One human (seat 0) vs three bots, driven over a WebSocket.

The session runs the engine generator in an asyncio task. Bot inference runs
in a worker thread. Every message sent to the client is kept in ``history``,
so a reconnecting client gets the full stream again and rebuilds its table.

Server -> client messages:
    {"type": "event", "event": <masked mjai event>, "actions": [...], "hint": [...]}
        ``actions`` / ``hint`` only when the human must decide now.
    {"type": "error", "message": str, "fatal": bool}
    {"type": "saved", "path": str}          after end_game
    {"type": "autoplay", "on": bool}       current AI 代打 state
Client -> server:
    {"type": "action", "action": <one of the offered actions>}
    {"type": "autoplay", "on": bool}       Mortal plays the human's seat
    {"type": "quit", "save": bool}         leave the game (see ``quit``); answered with
                                           {"type": "quit", "saved": path | null}
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import WebSocket

from backend import mortal
from backend.agents.autopilot import autopilot_action
from backend.agents.mortal_agent import MortalAgent
from backend.agents.simple_agent import SimpleAgent
from backend.engine.actions import legal_actions
from backend.engine.game import Game, mask_event
from backend.engine.replay import write_log
from backend.engine.rules import Rules

log = logging.getLogger(__name__)

BOT_IDS = ["ai1", "ai2", "ai3"]
DEFAULT_BOT_NAMES = ("AI-A", "AI-B", "AI-C")
_AUTO = {"__autoplay__": True}  # queued to wake a pending decision when autoplay turns on


def assign_seats(rng: random.Random, human_seat: int | None = None) -> tuple[int, list[str]]:
    """Random seat for the human (seat 0 is always the first dealer), bots shuffled into the rest."""
    human = rng.randrange(4) if human_seat is None else human_seat
    bots = list(BOT_IDS)
    rng.shuffle(bots)
    return human, ["human" if s == human else bots.pop() for s in range(4)]
FORCED_THINK = (0.3, 1.0)  # forced tsumogiri after riichi


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
        think: tuple[float, float] = (1.0, 3.0),
        bot_temps: tuple[float, float, float] = (0.0, 0.0, 0.0),
        bot_names: tuple[str, str, str] = DEFAULT_BOT_NAMES,
        human_seat: int | None = None,
        auto_temp: float = 0.0,
        log_dir: Path = Path("data/games"),
    ):
        self.id = game_id
        self.rng = random.Random()
        self.human, self.players = assign_seats(self.rng, human_seat)
        self.autoplay = False  # AI 代打: Mortal plays the human's seat
        self.auto_temp = auto_temp
        self.auto_decisions = 0
        self.bot_temps = dict(zip(BOT_IDS, bot_temps))
        bot_name = dict(zip(BOT_IDS, bot_names))
        names = [player_name if p == "human" else bot_name[p] for p in self.players]
        meta = {
            "started_at": datetime.now().isoformat(timespec="seconds"),
            "length": rules.length,
            "human": self.human,
            "players": self.players,
            "temperatures": {bot_name[b]: t for b, t in self.bot_temps.items()},
        }
        self.game = Game(rules, seed=seed, names=names, meta=meta)
        self.bot_kind = bots
        self.hints = hints
        self.think = think  # bots' simulated thinking time range, seconds
        self.log_dir = log_dir
        self.history: list[dict] = []
        self.pending: dict | None = None  # the message awaiting the human's action
        self.finished = False
        self._ws: WebSocket | None = None
        self._actions: asyncio.Queue[dict] = asyncio.Queue()
        self._task: asyncio.Task | None = None

    # -- connection --------------------------------------------------------

    def start(self) -> None:
        """Start the game loop (once). Called when the first client attaches, so the client sees
        the first kyoku live (with its intro animation) rather than as replayed history."""
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    async def attach(self, ws: WebSocket) -> None:
        """Make ``ws`` the client and replay everything sent so far."""
        self._ws = None
        await ws.send_json({"type": "autoplay", "on": self.autoplay})
        sent = 0
        while sent < len(self.history):  # the game may append while we replay
            msg = self.history[sent]
            out = msg if msg is self.pending else {k: v for k, v in msg.items() if k not in ("actions", "hint")}
            await ws.send_json({**out, "replay": msg is not self.pending})
            sent += 1
        self._ws = ws  # no await since the loop's last check: nothing can slip in between
        self.start()

    def detach(self, ws: WebSocket) -> None:
        if self._ws is ws:
            self._ws = None

    async def submit(self, action: dict) -> None:
        await self._actions.put(action)

    async def set_autoplay(self, on: bool) -> None:
        self.autoplay = on
        if on and self.pending is not None:
            await self._actions.put(_AUTO)  # resolve the open decision automatically
        await self._send({"type": "autoplay", "on": on}, record=False)

    async def quit(self, save: bool) -> str | None:
        """Stop the game because the player left it.

        With ``save``, the log so far is written like a finished game's, minus
        ``end_game`` (so it shows as unfinished and stays out of stats / drills).
        Returns the saved path, if any.
        """
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except BaseException:  # CancelledError (or a crash) — the game is over either way
                pass
        path = None
        if save and not self.finished and any(e["type"] == "start_kyoku" for e in self.game.log):
            path = self.log_dir / f"{self.id}.json.gz"
            await asyncio.to_thread(write_log, path, list(self.game.log))
        self.finished = True
        return str(path) if path else None

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
        seats = {s: p for s, p in enumerate(self.players) if p != "human"}
        if self.bot_kind == "simple":
            bots = {s: SimpleAgent(s, seed=self.game.seed + s) for s in seats}
        else:
            bots = {s: MortalAgent(s, self.bot_temps[p]) for s, p in seats.items()}
        # A greedy shadow Mortal in the human's seat provides hints and AI 代打.
        shadow = MortalAgent(self.human) if (self.hints or self.bot_kind == "mortal") else None
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
                    return outs, shadow.react(mask_event(ev, me)) if shadow else None

                me = self.human
                outs, shadow_out = await asyncio.to_thread(react)
                actions = {s: outs[s] for s in need if s != me}

                msg: dict = {"type": "event", "event": mask_event(ev, me)}
                if me in need:
                    legal = legal_actions(self.game._refs[me], need[me], self.game.state, me, ev)
                    auto = autopilot_action(legal, shadow_out, self.auto_temp, self.rng)
                    if self.autoplay:
                        await self._send(msg)
                        await asyncio.sleep(self._think_time({me: auto}))
                        choice = _AUTO
                    else:
                        msg["actions"] = legal
                        if shadow_out and shadow_out.get("meta") and self.hints:
                            msg["hint"] = mortal.top_actions(shadow_out["meta"], self.game._refs[me])
                        self.pending = msg
                        await self._send(msg)
                        choice = await self._wait_human(legal)
                        self.pending = None
                    if choice is _AUTO:
                        self.auto_decisions += 1
                        choice = auto
                    actions[me] = choice
                else:
                    await self._send(msg)
                    await asyncio.sleep(self._think_time(actions))

                try:
                    prompt = gen.send(actions)
                except StopIteration:
                    break
            path = self.log_dir / f"{self.id}.json.gz"
            self.game.log[-1]["auto_decisions"] = self.auto_decisions  # end_game: how much AI 代打
            await asyncio.to_thread(write_log, path, self.game.log)
            self.finished = True
            await self._send({"type": "saved", "path": str(path)})
        except Exception as ex:
            log.exception("game %s crashed", self.id)
            await self._send({"type": "error", "message": f"{type(ex).__name__}: {ex}", "fatal": True})

    def _think_time(self, actions: dict[int, Any]) -> float:
        """Simulated thinking before the bots' decisions take effect.

        Only real decisions take time: a bot passing on a call is instant, or
        its pause would reveal that it could have called.
        """
        lo, hi = self.think
        if hi <= 0:
            return 0.0
        t = 0.0
        for seat, action in actions.items():
            if not action or action.get("type") == "none":
                continue
            forced = action.get("type") == "dahai" and self.game.state.seats[seat].riichi_accepted
            t = max(t, self.rng.uniform(*FORCED_THINK) if forced else self.rng.uniform(lo, hi))
        return t

    async def _wait_human(self, legal: list[dict]) -> dict:
        allowed = {_key(a): a for a in legal}
        while True:
            action = await self._actions.get()
            if action is _AUTO:
                return _AUTO
            if _key(action) in allowed:
                return allowed[_key(action)]
            await self._send({"type": "error", "message": f"illegal action: {action}", "fatal": False}, record=False)
