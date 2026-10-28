"""AI 代打: autopilot action choice, live autoplay over WebSocket, batch games."""
import random
import time

import pytest
from tests.weights import requires_weights
from fastapi.testclient import TestClient

from backend import storage
from backend.agents.autopilot import autopilot_action
from backend.server import batch
from backend.server.app import app

LEGAL = [
    {"type": "dahai", "actor": 0, "pai": "1m", "tsumogiri": False},
    {"type": "dahai", "actor": 0, "pai": "C", "tsumogiri": True},
    {"type": "reach", "actor": 0},
]


@pytest.fixture(autouse=True)
def tmp_settings(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(storage, "load_settings", lambda: storage.Settings(log_dir=str(tmp_path / "games"), think_min=0, think_max=0))
    return tmp_path


def test_autopilot_greedy_uses_shadow_action():
    shadow = {"type": "dahai", "actor": 0, "pai": "C", "tsumogiri": True, "meta": {}}
    assert autopilot_action(LEGAL, shadow, 0.0, random.Random(1)) == LEGAL[1]
    # no usable shadow: falls back to a legal action
    assert autopilot_action(LEGAL, None, 0.0, random.Random(1)) in LEGAL


def _play(client, game_id, *, autoplay_from=None):
    decisions = 0
    with client.websocket_connect(f"/api/games/{game_id}/ws") as ws:
        while True:
            msg = ws.receive_json()
            assert msg["type"] != "error", msg
            if msg["type"] == "saved":
                return decisions
            if "actions" in msg:
                decisions += 1
                if autoplay_from is not None and decisions >= autoplay_from:
                    ws.send_json({"type": "autoplay", "on": True})  # takes over the open decision
                else:
                    a = next((x for x in msg["actions"] if x["type"] == "none"), None) or next(
                        x for x in msg["actions"] if x["type"] == "dahai"
                    )
                    ws.send_json({"type": "action", "action": a})


@requires_weights
def test_live_autoplay_takes_over(tmp_settings):
    with TestClient(app) as client:
        gid = client.post("/api/games", json={"length": "tonpuu", "seed": 4, "bots": "simple", "think": [0, 0]}).json()["game_id"]
        asked = _play(client, gid, autoplay_from=3)
        assert asked == 3  # after switching on, no more decisions are asked
        meta = client.get("/api/logs").json()["games"][0]
        assert meta["autoplay"] == "partial"


@requires_weights
def test_batch_autoplay(tmp_settings):
    with TestClient(app) as client:
        r = client.post("/api/batch", json={"length": "tonpuu", "count": 1})
        assert r.status_code == 200 and r.json()["running"]
        assert client.post("/api/batch", json={"length": "tonpuu", "count": 1}).status_code == 409
        for _ in range(300):
            st = client.get("/api/batch").json()
            if not st["running"]:
                break
            time.sleep(0.5)
        assert st["done"] == 1 and st["error"] is None
        games = client.get("/api/logs").json()["games"]
        assert len(games) == 1 and games[0]["autoplay"] == "full" and games[0]["finished"]
        # fully AI-played games are left out of the default stats
        assert client.post("/api/stats", json={}).json()["stat"] is None
    batch.status = batch.BatchStatus()
