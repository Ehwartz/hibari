"""FastAPI app: create games and play them over WebSocket.

    uv run uvicorn backend.server.app:app --port 8000

If ``frontend/dist`` exists (``npm run build``), the built UI is served at
``/`` as well, so a single process is enough (used by ``scripts/launch.py``).
"""
from __future__ import annotations

import asyncio
import random
import uuid
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend import mortal, storage
from backend.analysis import quiz
from backend.analysis.review import review_game
from backend.engine.rules import Rules
from backend.server import batch
from backend.server.session import GameSession

app = FastAPI(title="Hibari 雲雀")
sessions: dict[str, GameSession] = {}


class NewGame(BaseModel):
    # unset fields fall back to the saved settings
    length: Literal["hanchan", "tonpuu"] | None = None
    seed: int | None = None
    hints: bool = True
    player_name: str | None = None
    # bots' simulated thinking time per decision, [min, max] seconds
    think: tuple[float, float] | None = None
    # sampling temperature / display name of the three bots
    bot_temps: tuple[float, float, float] | None = None
    bot_names: tuple[str, str, str] | None = None
    # the human's seat (0 = first dealer); random when unset
    seat: int | None = Field(default=None, ge=0, le=3)
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
        bot_temps=req.bot_temps or tuple(settings.bot_temps),
        bot_names=req.bot_names or tuple(settings.bot_names),
        human_seat=req.seat,
        auto_temp=settings.auto_temp,
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
            elif msg.get("type") == "autoplay":
                await session.set_autoplay(bool(msg.get("on")))
    except WebSocketDisconnect:
        session.detach(ws)



# -- settings / user ------------------------------------------------------------


class SettingsIn(BaseModel):
    player_name: str = Field(min_length=1, max_length=16)
    log_dir: str = Field(min_length=1)
    default_length: Literal["hanchan", "tonpuu"]
    think_min: float = Field(ge=0, le=30)
    think_max: float = Field(ge=0, le=30)
    bot_temps: list[float] = Field(default=[0.0, 0.0, 0.0], min_length=3, max_length=3)
    bot_names: list[str] = Field(default=["AI-A", "AI-B", "AI-C"], min_length=3, max_length=3)
    ai_name: str = Field(default="Mortal", min_length=1, max_length=16)
    pt_mode: Literal["score", "tenhou"] = "score"
    pt_dan: int = Field(default=7, ge=1, le=10)
    bot_dir: str = Field(default="mjbot_mortal", min_length=1)
    auto_temp: float = Field(default=0.0, ge=0, le=2)
    felt: str = Field(default="green", max_length=32)
    background: str = Field(default="dark", max_length=32)


def _settings_out(s: storage.Settings) -> dict:
    return {
        **asdict(s),
        "log_dir_resolved": str(s.log_path),
        "asset_dir": str(storage.ASSET_DIR),
        "bot_dir_resolved": str(storage.bot_dir_path(s)),
        # the folder this process actually loaded (bot_dir changes need a restart)
        "bot_dir_loaded": str(mortal.MORTAL_DIR),
    }


@app.get("/api/settings")
async def get_settings() -> dict:
    return _settings_out(storage.load_settings())


@app.put("/api/settings")
async def put_settings(body: SettingsIn) -> dict:
    if body.think_max < body.think_min:
        raise HTTPException(422, "think_max < think_min")
    if not all(0 <= t <= 2 for t in body.bot_temps):
        raise HTTPException(422, "bot temperature must be within 0..2")
    body.bot_names = [n.strip() for n in body.bot_names]
    if not all(1 <= len(n) <= 16 for n in body.bot_names):
        raise HTTPException(422, "bot names must be 1-16 characters")
    body.ai_name = body.ai_name.strip() or "Mortal"
    bot = storage.bot_dir_path(storage.Settings(bot_dir=body.bot_dir))
    if not (bot / "model.py").is_file():
        raise HTTPException(422, f"not a bot folder (no model.py): {bot}")
    # uploaded assets are managed by /api/assets; keep them
    s = storage.Settings(**body.model_dump(), assets=storage.load_settings().assets)
    try:
        s.log_path.mkdir(parents=True, exist_ok=True)
    except OSError as ex:
        raise HTTPException(422, f"cannot use folder: {ex}") from None
    storage.save_settings(s)
    return _settings_out(s)


# -- assets: avatars, table cloth, background ---------------------------------------


@app.get("/api/assets/{name}")
async def get_asset(name: str) -> FileResponse:
    if name not in storage.ASSETS or (path := storage.asset_path(name)) is None:
        raise HTTPException(404, "no such asset")
    return FileResponse(path)


@app.put("/api/assets/{name}")
async def put_asset(name: str, request: Request) -> dict:
    """Upload an image (raw body, Content-Type image/png|jpeg|webp)."""
    data = await request.body()
    try:
        s = storage.save_asset(name, data, request.headers.get("content-type", "").split(";")[0].strip())
    except KeyError:
        raise HTTPException(404, "no such asset") from None
    except ValueError as ex:
        raise HTTPException(422, str(ex)) from None
    return _settings_out(s)


@app.delete("/api/assets/{name}")
async def delete_asset(name: str) -> dict:
    try:
        return _settings_out(storage.delete_asset(name))
    except KeyError:
        raise HTTPException(404, "no such asset") from None


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


def _log_path(game_id: str) -> Path:
    try:
        path = storage.log_file(storage.load_settings(), game_id)
    except ValueError:
        raise HTTPException(400, "bad id") from None
    if not path.exists():
        raise HTTPException(404, "no such log")
    return path


@app.get("/api/logs/{game_id}/review")
async def get_review(game_id: str) -> dict:
    review = storage.read_review(_log_path(game_id))
    if review is None:
        raise HTTPException(404, "not reviewed")
    return review


@app.post("/api/logs/{game_id}/review")
async def run_review(game_id: str) -> dict:
    """Run (or re-run) the Mortal review of a saved game; takes a few seconds."""
    path = _log_path(game_id)
    events = storage.read_events(path)
    review = await asyncio.to_thread(review_game, events)
    storage.save_review(path, review)
    return review


# -- discard drills (何切练习) ------------------------------------------------------


@app.get("/api/drills")
async def list_drills() -> dict:
    return await asyncio.to_thread(storage.list_drills, storage.load_settings())


class DrillAnswer(BaseModel):
    id: str = Field(max_length=100)
    choice: str = Field(max_length=16)


@app.post("/api/drills/answer")
async def answer_drill(a: DrillAnswer) -> dict:
    try:
        return storage.grade_drill(storage.load_settings(), a.id, a.choice)
    except (KeyError, ValueError):
        raise HTTPException(404, "no such drill") from None


@app.delete("/api/drills/results")
async def reset_drills() -> dict:
    storage.reset_drills()
    return {"ok": True}


# -- generated quizzes (听牌 / 点数) ---------------------------------------------------


@app.get("/api/quiz/wait")
async def quiz_wait(mode: Literal["mixed", "chinitsu"] = "mixed", seed: int | None = None) -> dict:
    return quiz.wait_question(random.Random(seed), mode)


@app.get("/api/quiz/score")
async def quiz_score(seed: int | None = None) -> dict:
    return quiz.score_question(random.Random(seed))


class BatchRequest(BaseModel):
    length: Literal["hanchan", "tonpuu"] = "hanchan"
    count: int = Field(ge=1, le=200)


@app.post("/api/batch")
async def start_batch(req: BatchRequest) -> dict:
    """AI 代打 N games back to back (Mortal in every seat) to build up logs."""
    try:
        batch.start(req.length, req.count)
    except RuntimeError as ex:
        raise HTTPException(409, str(ex)) from None
    return batch.snapshot()


@app.get("/api/batch")
async def batch_status() -> dict:
    return batch.snapshot()


@app.post("/api/batch/cancel")
async def cancel_batch() -> dict:
    batch.cancel()
    return batch.snapshot()


class StatsQuery(BaseModel):
    game_ids: list[str] | None = None


@app.post("/api/stats")
async def stats(q: StatsQuery) -> dict:
    return await asyncio.to_thread(storage.compute_stats, storage.load_settings(), q.game_ids)


FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if FRONTEND_DIST.is_dir():  # mounted last so /api routes take precedence
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
