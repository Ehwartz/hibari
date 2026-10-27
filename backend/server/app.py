"""FastAPI app: create games and play them over WebSocket.

    uv run uvicorn backend.server.app:app --port 8000
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from backend.engine.rules import Rules
from backend.server.session import GameSession

app = FastAPI(title="Mahjong AI Trainer")
sessions: dict[str, GameSession] = {}


class NewGame(BaseModel):
    length: Literal["hanchan", "tonpuu"] = "hanchan"
    seed: int | None = None
    hints: bool = True
    player_name: str = "You"
    # bots' simulated thinking time per decision, [min, max] seconds
    think: tuple[float, float] = (2.0, 8.0)
    # "simple" swaps Mortal for the rule-based fuzzing agent (tests, quick UI checks)
    bots: Literal["mortal", "simple"] = "mortal"


@app.post("/api/games")
async def create_game(req: NewGame) -> dict:
    game_id = uuid.uuid4().hex[:12]
    session = GameSession(
        game_id,
        Rules(length=req.length),
        seed=req.seed,
        bots=req.bots,
        hints=req.hints,
        player_name=req.player_name,
        think=req.think,
    )
    sessions[game_id] = session
    session.start()
    return {"game_id": game_id, "seed": session.game.seed}


@app.get("/api/games/{game_id}")
async def game_status(game_id: str) -> dict:
    session = sessions.get(game_id)
    if session is None:
        raise HTTPException(404, "no such game")
    return {"game_id": game_id, "finished": session.finished, "scores": session.game.scores}


@app.websocket("/api/games/{game_id}/ws")
async def play(ws: WebSocket, game_id: str) -> None:
    session = sessions.get(game_id)
    if session is None:
        await ws.close(code=4404)
        return
    await ws.accept()
    await session.attach(ws)
    try:
        while True:
            msg = await ws.receive_json()
            if msg.get("type") == "action":
                await session.submit(msg["action"])
    except WebSocketDisconnect:
        session.detach(ws)
