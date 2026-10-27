"""Desktop-style launcher: backend + Chrome app window, no browser chrome.

1. Rebuilds ``frontend/dist`` if the frontend sources are newer.
2. Starts the backend (which also serves the built UI) on a free port.
3. Opens Chrome in ``--app`` mode with its own profile, so the window behaves
   like a separate program (own taskbar entry, no address bar / tabs).
4. When that window is closed, stops the backend.

Run with ``start.cmd`` (no console), or ``uv run python -m scripts.launch``.
Output goes to ``data/launcher.log``.
"""
from __future__ import annotations

import logging
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import winreg
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DATA = ROOT / "data"
NODE_DIR = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "nodejs"
NO_WINDOW = subprocess.CREATE_NO_WINDOW

log = logging.getLogger("launcher")


def find_chrome() -> str:
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe") as k:
                path = winreg.QueryValue(k, None)
                if path and Path(path).exists():
                    return path
        except OSError:
            pass
    for base in (os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")):
        if base and (p := Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe").exists():
            return str(p)
    raise FileNotFoundError("Chrome not found")


def _newest_mtime(paths: list[Path]) -> float:
    newest = 0.0
    for p in paths:
        files = [p] if p.is_file() else (f for f in p.rglob("*") if f.is_file())
        newest = max([newest, *(f.stat().st_mtime for f in files)])
    return newest


def ensure_frontend_built() -> None:
    built = FRONTEND / "dist" / "index.html"
    sources = [FRONTEND / "src", FRONTEND / "public", FRONTEND / "index.html", FRONTEND / "package.json"]
    if built.exists() and built.stat().st_mtime >= _newest_mtime(sources):
        return
    env = {**os.environ, "PATH": f"{NODE_DIR}{os.pathsep}{os.environ.get('PATH', '')}"}
    npm = shutil.which("npm", path=env["PATH"]) or "npm"
    log.info("building frontend")
    if not (FRONTEND / "node_modules").exists():
        subprocess.run([npm, "install"], cwd=FRONTEND, env=env, check=True, creationflags=NO_WINDOW)
    subprocess.run([npm, "run", "build"], cwd=FRONTEND, env=env, check=True, creationflags=NO_WINDOW)


def free_port(preferred: int = 8000) -> int:
    for port in (preferred, 0):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("no free port")


def wait_ready(url: str, proc: subprocess.Popen, timeout: float = 60) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"backend exited with code {proc.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=1):
                return
        except OSError:
            time.sleep(0.3)
    raise TimeoutError(f"backend not ready: {url}")


def main() -> None:
    DATA.mkdir(exist_ok=True)
    logging.basicConfig(
        filename=DATA / "launcher.log",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    try:
        ensure_frontend_built()
        port = free_port()
        python = Path(sys.executable)
        if python.name.lower() == "pythonw.exe":  # keep the server's own output going to the log
            python = python.with_name("python.exe")
        server_log = open(DATA / "server.log", "a", encoding="utf-8")
        server = subprocess.Popen(
            [str(python), "-m", "uvicorn", "backend.server.app:app", "--port", str(port)],
            cwd=ROOT,
            stdout=server_log,
            stderr=subprocess.STDOUT,
            creationflags=NO_WINDOW,
        )
        try:
            url = f"http://127.0.0.1:{port}/"
            wait_ready(url + "api/health", server)
            log.info("backend ready at %s", url)
            chrome = subprocess.Popen(
                [
                    find_chrome(),
                    f"--app={url}",
                    f"--user-data-dir={DATA / 'chrome-app'}",
                    "--window-size=1600,1000",
                    "--no-first-run",
                    "--no-default-browser-check",
                ]
            )
            chrome.wait()  # own profile: returns when the app window is closed
            log.info("window closed")
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
    except Exception:
        log.exception("launcher failed")
        raise


if __name__ == "__main__":
    main()
