"""FastAPI app: create games and play them over WebSocket.

    uv run uvicorn backend.server.app:app --port 8000

If ``frontend/dist`` exists (``npm run build``), the built UI is served at
``/`` as well, so a single process is enough (used by ``scripts/launch.py``).
"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend import storage
from backend.engine.rules import Rules
from backend.server.session import GameSession

app = FastAPI(title="Mahjong AI Trainer")
sessions: dict[str, GameSession] = {}


class NewGame(BaseModel):
    # unset fields fall back to the saved settings
    length: Literal["hanchan", "tonpuu"] | None = None
    seed: int | None = None
    hints: bool = True
    player_name: str | None = None
    # bots' simulated thinking time per decision, [min, max] seconds
    think: tuple[float, float] | None = None
    # "simple" swaps Mortal for the rule-based fuzzing agent (tests, quick UI checks)
    bots: Literal["mortal", "simple"] = "mortal"


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True}


@app.post("/api/games")
async def create_game(req: NewGame) -> dict:
    settings = storage.load_settings()
    game_id = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    session = GameSession(
        game_id,
        Rules(length=req.length or settings.default_length),
        seed=req.seed,
        bots=req.bots,
        hints=req.hints,
        player_name=req.player_name or settings.player_name,
        think=req.think or (settings.think_min, settings.think_max),
        log_dir=settings.log_path,
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



# -- settings / user ------------------------------------------------------------


class SettingsIn(BaseModel):
    player_name: str = Field(min_length=1, max_length=16)
    log_dir: str = Field(min_length=1)
    default_length: Literal["hanchan", "tonpuu"]
    think_min: float = Field(ge=0, le=30)
    think_max: float = Field(ge=0, le=30)


@app.get("/api/settings")
async def get_settings() -> dict:
    s = storage.load_settings()
    return {**asdict(s), "log_dir_resolved": str(s.log_path)}


@app.put("/api/settings")
async def put_settings(body: SettingsIn) -> dict:
    if body.think_max < body.think_min:
        raise HTTPException(422, "think_max < think_min")
    s = storage.Settings(**body.model_dump())
    try:
        s.log_path.mkdir(parents=True, exist_ok=True)
    except OSError as ex:
        raise HTTPException(422, f"cannot use folder: {ex}") from None
    storage.save_settings(s)
    return {**asdict(s), "log_dir_resolved": str(s.log_path)}


# -- saved logs -------------------------------------------------------------------


@app.get("/api/logs")
async def list_logs() -> dict:
    s = storage.load_settings()
    return {"folder": str(s.log_path), "games": [asdict(g) for g in storage.list_games(s)]}


@app.get("/api/logs/{game_id}")
async def get_log(game_id: str) -> dict:
    s = storage.load_settings()
    try:
        path = storage.log_file(s, game_id)
    except ValueError:
        raise HTTPException(400, "bad id") from None
    if not path.exists():
        raise HTTPException(404, "no such log")
    return {"id": game_id, "events": storage.read_events(path)}


@app.delete("/api/logs/{game_id}")
async def delete_log(game_id: str) -> dict:
    try:
        ok = storage.delete_game(storage.load_settings(), game_id)
    except ValueError:
        raise HTTPException(400, "bad id") from None
    if not ok:
        raise HTTPException(404, "no such log")
    return {"deleted": game_id}


class StatsQuery(BaseModel):
    game_ids: list[str] | None = None


@app.post("/api/stats")
async def stats(q: StatsQuery) -> dict:
    return await asyncio.to_thread(storage.compute_stats, storage.load_settings(), q.game_ids)


FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if FRONTEND_DIST.is_dir():  # mounted last so /api routes take precedence
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
