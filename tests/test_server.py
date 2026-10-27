"""Server: a full game over WebSocket with a scripted human (simple bots for speed)."""
import pytest
from fastapi.testclient import TestClient

from backend import storage
from backend.server.app import app


@pytest.fixture(autouse=True)
def tmp_settings(tmp_path, monkeypatch):
    """Keep settings and saved logs out of the real data/ folder."""
    monkeypatch.setattr(storage, "SETTINGS_FILE", tmp_path / "settings.json")
    monkeypatch.setattr(storage, "load_settings", lambda: storage.Settings(log_dir=str(tmp_path / "games")))
    return tmp_path


def _pick(actions):
    """Win if possible, otherwise pass on calls, otherwise discard the drawn tile."""
    for t in ("hora", "none"):
        for a in actions:
            if a["type"] == t:
                return a
    dahai = [a for a in actions if a["type"] == "dahai"]
    return next((a for a in dahai if a["tsumogiri"]), dahai[0] if dahai else actions[0])


def test_full_game_over_websocket():
    with TestClient(app) as client:
        r = client.post(
            "/api/games",
            json={"length": "tonpuu", "seed": 7, "bots": "simple", "hints": False, "think": [0, 0], "seat": 2},
        )
        game_id = r.json()["game_id"]
        types, decisions = [], 0
        with client.websocket_connect(f"/api/games/{game_id}/ws") as ws:
            while True:
                msg = ws.receive_json()
                assert msg["type"] != "error", msg
                if msg["type"] == "saved":
                    break
                ev = msg["event"]
                types.append(ev["type"])
                if ev["type"] == "start_game":
                    assert ev["id"] == 2 and ev["human"] == 2 and ev["players"][2] == "human"
                if ev["type"] == "tsumo":
                    assert (ev["pai"] == "?") == (ev["actor"] != 2)  # only our own draws are visible
                if "actions" in msg:
                    assert all(a.get("actor", 2) == 2 for a in msg["actions"])
                    decisions += 1
                    ws.send_json({"type": "action", "action": _pick(msg["actions"])})
        assert types[0] == "start_game" and types[-1] == "end_game"
        assert decisions > 20
        assert client.get(f"/api/games/{game_id}").json()["finished"]


def test_illegal_action_is_rejected_and_reconnect_replays():
    with TestClient(app) as client:
        game_id = client.post("/api/games", json={"length": "tonpuu", "seed": 3, "bots": "simple", "hints": False, "think": [0, 0]}).json()["game_id"]
        with client.websocket_connect(f"/api/games/{game_id}/ws") as ws:
            msg = ws.receive_json()
            while "actions" not in msg:
                msg = ws.receive_json()
            ws.send_json({"type": "action", "action": {"type": "dahai", "actor": 0, "pai": "9z", "tsumogiri": False}})
            err = ws.receive_json()
            assert err["type"] == "error" and not err["fatal"]
        # reconnect: full history replayed, the pending decision comes last with its actions
        with client.websocket_connect(f"/api/games/{game_id}/ws") as ws:
            replayed = [ws.receive_json()]
            while "actions" not in replayed[-1]:
                replayed.append(ws.receive_json())
            assert replayed[0]["event"]["type"] == "start_game" and replayed[0]["replay"]
            assert replayed[-1]["replay"] is False


def test_think_time_only_for_real_decisions():
    from backend.engine.rules import Rules
    from backend.server.session import GameSession

    s = GameSession("t", Rules(), seed=1, think=(2.0, 8.0))
    s.game.state = type("St", (), {"seats": [type("Seat", (), {"riichi_accepted": False})() for _ in range(4)]})()
    assert s._think_time({1: {"type": "none"}, 2: None}) == 0.0
    assert 2.0 <= s._think_time({1: {"type": "dahai", "actor": 1, "pai": "1m", "tsumogiri": True}}) <= 8.0
    s.game.state.seats[1].riichi_accepted = True
    assert s._think_time({1: {"type": "dahai", "actor": 1, "pai": "1m", "tsumogiri": True}}) <= 1.0
    assert GameSession("t", Rules(), think=(0, 0))._think_time({1: {"type": "pon"}}) == 0.0


def _play_to_end(client, game_id):
    with client.websocket_connect(f"/api/games/{game_id}/ws") as ws:
        while True:
            msg = ws.receive_json()
            if msg["type"] == "saved":
                return msg["path"]
            if "actions" in msg:
                ws.send_json({"type": "action", "action": _pick(msg["actions"])})


def test_logs_and_stats_api(tmp_settings):
    with TestClient(app) as client:
        game_id = client.post(
            "/api/games", json={"length": "tonpuu", "seed": 11, "bots": "simple", "hints": False, "think": [0, 0]}
        ).json()["game_id"]
        path = _play_to_end(client, game_id)
        assert str(tmp_settings) in path

        listed = client.get("/api/logs").json()["games"]
        assert [g["id"] for g in listed] == [game_id]
        meta = listed[0]
        assert meta["finished"] and meta["length"] == "tonpuu" and 1 <= meta["rank"] <= 4

        events = client.get(f"/api/logs/{game_id}").json()["events"]
        assert events[0]["type"] == "start_game" and events[0]["started_at"]

        stats = client.post("/api/stats", json={}).json()
        assert stats["stat"]["game"] == 1 and stats["stat"]["round"] >= 4
        assert stats["stat"]["avg_rank"] == meta["rank"]

        assert client.get("/api/logs/..%2Fsecret").status_code in (400, 404)
        assert client.delete(f"/api/logs/{game_id}").status_code == 200
        assert client.get("/api/logs").json()["games"] == []
        assert client.post("/api/stats", json={}).json()["stat"] is None


def test_settings_roundtrip(tmp_settings):
    with TestClient(app) as client:
        body = {"player_name": "雀士", "log_dir": str(tmp_settings / "logs2"), "default_length": "tonpuu", "think_min": 0.5, "think_max": 2}
        r = client.put("/api/settings", json=body)
        assert r.status_code == 200 and (tmp_settings / "logs2").is_dir()
        assert storage.SETTINGS_FILE.exists() and "雀士" in storage.SETTINGS_FILE.read_text(encoding="utf-8")
        assert client.put("/api/settings", json={**body, "think_min": 3, "think_max": 1}).status_code == 422
        named = client.put("/api/settings", json={**body, "bot_names": [" 小A ", "B", "C"]})
        assert named.status_code == 200 and named.json()["bot_names"] == ["小A", "B", "C"]
        assert client.put("/api/settings", json={**body, "bot_names": ["", "B", "C"]}).status_code == 422


def test_assets_upload_get_delete(tmp_settings, monkeypatch):
    monkeypatch.setattr(storage, "ASSET_DIR", tmp_settings / "assets")
    monkeypatch.setattr(storage, "load_settings", lambda: storage.Settings(**_saved(tmp_settings)))
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    with TestClient(app) as client:
        r = client.put("/api/assets/avatar_player", content=png, headers={"Content-Type": "image/png"})
        assert r.status_code == 200 and "avatar_player" in r.json()["assets"]
        assert (tmp_settings / "assets" / "avatars" / "player.png").read_bytes() == png
        assert client.get("/api/assets/avatar_player").content == png
        # settings PUT keeps the asset versions
        body = {"player_name": "A", "log_dir": str(tmp_settings / "g"), "default_length": "hanchan",
                "think_min": 1, "think_max": 2, "felt": "blue", "background": "dark"}
        assert "avatar_player" in client.put("/api/settings", json=body).json()["assets"]
        assert client.put("/api/assets/avatar_player", content=b"x", headers={"Content-Type": "text/plain"}).status_code == 422
        assert client.put("/api/assets/nope", content=png, headers={"Content-Type": "image/png"}).status_code == 404
        assert client.delete("/api/assets/avatar_player").status_code == 200
        assert client.get("/api/assets/avatar_player").status_code == 404


def _saved(tmp):
    import json

    f = tmp / "settings.json"
    if not f.exists():
        return {"log_dir": str(tmp / "games")}
    return {k: v for k, v in json.loads(f.read_text(encoding="utf-8")).items() if k in storage.Settings.__dataclass_fields__}


def test_random_seat_and_bot_assignment():
    from backend.engine.rules import Rules
    from backend.server.session import GameSession

    seats = set()
    for i in range(40):
        sess = GameSession(f"t{i}", Rules(), bot_temps=(0.0, 0.3, 1.0), bot_names=("东", "南", "西"))
        seats.add(sess.human)
        assert sorted(sess.players) == ["ai1", "ai2", "ai3", "human"]
        assert sess.players[sess.human] == "human"
        assert sess.game.names[sess.human] == "You"
        named = {p: sess.game.names[s] for s, p in enumerate(sess.players)}
        assert (named["ai1"], named["ai2"], named["ai3"]) == ("东", "南", "西")
    assert seats == {0, 1, 2, 3}
    assert sess.bot_temps == {"ai1": 0.0, "ai2": 0.3, "ai3": 1.0}
