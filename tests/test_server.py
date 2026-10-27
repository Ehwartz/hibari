"""Server: a full game over WebSocket with a scripted human (simple bots for speed)."""
from fastapi.testclient import TestClient

from backend.server.app import app


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
        r = client.post("/api/games", json={"length": "tonpuu", "seed": 7, "bots": "simple", "hints": False})
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
                if ev["type"] == "tsumo" and ev["actor"] != 0:
                    assert ev["pai"] == "?"  # masked
                if "actions" in msg:
                    decisions += 1
                    ws.send_json({"type": "action", "action": _pick(msg["actions"])})
        assert types[0] == "start_game" and types[-1] == "end_game"
        assert decisions > 20
        assert client.get(f"/api/games/{game_id}").json()["finished"]


def test_illegal_action_is_rejected_and_reconnect_replays():
    with TestClient(app) as client:
        game_id = client.post("/api/games", json={"length": "tonpuu", "seed": 3, "bots": "simple", "hints": False}).json()["game_id"]
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
