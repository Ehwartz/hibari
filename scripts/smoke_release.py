"""Smoke-test a release package with nothing but what it contains.

    uv run python -m scripts.smoke_release release/Hibari-0.1.0-<os>.zip|.tar.gz

Unpacks into a fresh folder (path with spaces and CJK), then, using the bundled interpreter only:
imports the launcher and looks for a browser, starts the server, plays a tonpuu over the WebSocket
(rule-based bots: no weights needed), checks the saved log and a quiz. If the package has the
weights, it also plays an AI 代打 game and reviews it. Exits non-zero on any failure.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

from websockets.sync.client import connect


def unpack(archive: Path, dest: Path) -> None:
    if archive.name.endswith(".tar.gz"):
        with tarfile.open(archive) as t:
            t.extractall(dest, filter="tar")  # keeps permissions and symlinks
    elif sys.platform == "darwin":
        subprocess.run(["ditto", "-x", "-k", str(archive), str(dest)], check=True)
    else:
        with zipfile.ZipFile(archive) as z:
            z.extractall(dest)


def find_app(dest: Path) -> tuple[Path, Path, dict[str, str]]:
    """(app folder, bundled python, extra env) for the unpacked package."""
    top = dest / "Hibari"
    if (top / "Hibari.app").is_dir():
        app = top / "Hibari.app" / "Contents" / "Resources" / "app"
        return app, app / "runtime/python/bin/python3", {"HIBARI_DATA": str(dest / "user data" / "data")}
    if (top / "Hibari.exe").exists():
        return top, top / "runtime/python/python.exe", {}
    return top, top / "runtime/python/bin/python3", {}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    archive = Path(sys.argv[1]).resolve()
    dest = Path(tempfile.mkdtemp()) / "测试 folder"
    dest.mkdir()
    t = time.time()
    unpack(archive, dest)
    app, py, extra_env = find_app(dest)
    print(f"unpacked in {time.time() - t:.0f}s: {app}")
    assert py.exists(), f"bundled python missing: {py}"
    has_weights = (app / "mjbot_mortal" / "mortal.pth").exists()

    # nothing from the build environment
    env = {k: v for k, v in os.environ.items() if not k.startswith(("PYTHON", "VIRTUAL_ENV", "UV_", "CONDA"))}
    env.update(extra_env, PYTHONNOUSERSITE="1")
    data = Path(extra_env.get("HIBARI_DATA", app / "data"))

    out = subprocess.run(
        [str(py), "-c", "import sys, json, scripts.launch as l; b = l.find_browser(); "
         "print(json.dumps({'path': sys.path, 'browser': b and [b[0], str(b[1]), l.browser_version(b[1])]}))"],
        cwd=app, env=env, capture_output=True, text=True,
    )
    assert out.returncode == 0, out.stderr
    info = json.loads(out.stdout.strip().splitlines()[-1])
    outside = [p for p in info["path"] if p and not os.path.realpath(p).startswith(os.path.realpath(app))]
    assert not outside, f"sys.path leaves the package: {outside}"
    print("launcher ok; browser:", info["browser"])

    port = free_port()
    base = f"http://127.0.0.1:{port}"
    log = open(dest / "server.log", "w")
    server = subprocess.Popen([str(py), "-m", "uvicorn", "backend.server.app:app", "--port", str(port)],
                              cwd=app, env=env, stdout=log, stderr=subprocess.STDOUT)

    def api(path: str, body: dict | None = None):
        req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read()) if r.headers.get_content_type() == "application/json" else r.read()

    try:
        for _ in range(240):
            try:
                api("/api/health")
                break
            except OSError:
                if server.poll() is not None:
                    raise RuntimeError("server exited")
                time.sleep(0.5)
        assert b"<div id=\"root\">" in api("/") or len(api("/")) > 200, "UI not served"
        print("server ok")

        # a whole tonpuu against rule-based bots (libriichi referee, scoring, log writing)
        gid = api("/api/games", {"length": "tonpuu", "seed": 5, "bots": "simple", "hints": False, "think": [0, 0]})["game_id"]
        with connect(f"ws://127.0.0.1:{port}/api/games/{gid}/ws", max_size=None) as ws:
            while True:
                msg = json.loads(ws.recv(timeout=120))
                if msg.get("type") == "saved":
                    break
                assert msg.get("type") != "error" or not msg.get("fatal"), msg
                if "actions" in msg:
                    acts = msg["actions"]
                    pick = next((a for a in acts if a["type"] in ("hora", "none")), None) or next(
                        (a for a in acts if a.get("tsumogiri")), acts[0])
                    ws.send(json.dumps({"type": "action", "action": pick}))
        games = api("/api/logs")["games"]
        assert any(g["id"] == gid and g["finished"] for g in games), games
        assert Path(api("/api/logs")["folder"]).resolve().is_relative_to(data.resolve())
        print(f"game ok: {len(games)} log(s) in {data}")
        assert api("/api/quiz/score?seed=1")["answer"]["han"] >= 1
        print("quiz ok")

        if has_weights:
            t = time.time()
            api("/api/batch", {"length": "tonpuu", "count": 1})
            while (b := api("/api/batch"))["running"]:
                time.sleep(1)
            assert b["done"] == 1 and not b["error"], b
            review = api(f"/api/logs/{b['games'][0]}/review", {})
            print(f"AI game + review ok ({time.time() - t:.0f}s): {review['summary']}")
        else:
            print("no weights in the package: AI game / review skipped")
    finally:
        server.terminate()
        server.wait(15)
        log.close()
        print((dest / "server.log").read_text(errors="replace")[-1500:])
    shutil.rmtree(dest.parent, ignore_errors=True)
    print("SMOKE TEST PASSED")


if __name__ == "__main__":
    main()
