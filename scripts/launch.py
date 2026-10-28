"""Desktop-style launcher: backend + Chrome app window, no browser chrome.

1. Rebuilds ``frontend/dist`` if the frontend sources are newer.
2. Starts the backend (which also serves the built UI) on a free port.
3. Opens Chrome in ``--app`` mode with its own profile, so the window behaves
   like a separate program (own taskbar entry, no address bar / tabs).
   Without Chrome it uses Edge (Chromium, same flags).
4. When that window is closed, stops the backend.

Run with ``start.cmd`` (no console), ``Hibari.exe`` in the portable release,
or ``uv run python -m scripts.launch``. Output goes to ``data/launcher.log``;
failures also show a message box (there is no console).
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
import ctypes
import winreg
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DATA = ROOT / "data"
NODE_DIR = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "nodejs"
NO_WINDOW = subprocess.CREATE_NO_WINDOW

log = logging.getLogger("launcher")


# the UI (Tailwind 4) needs Chromium 111+
MIN_CHROMIUM = 111


def _find_exe(app_paths_name: str, *rel: str) -> Path | None:
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive, rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{app_paths_name}") as k:
                path = winreg.QueryValue(k, None)
                if path and Path(path).exists():
                    return Path(path)
        except OSError:
            pass
    for base in (os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")):
        if base and (p := Path(base).joinpath(*rel)).exists():
            return p
    return None


def browser_version(exe: Path) -> int | None:
    """Major version of a Chromium browser, from the version folder next to its exe."""
    majors = [int(d.name.split(".")[0]) for d in exe.parent.iterdir() if d.is_dir() and d.name.split(".")[0].isdigit()]
    return max(majors) if majors else None


def find_browser() -> tuple[str, Path]:
    """Chrome if installed, otherwise Edge: (name, exe)."""
    chrome = _find_exe("chrome.exe", "Google", "Chrome", "Application", "chrome.exe")
    if chrome:
        return "Chrome", chrome
    edge = _find_exe("msedge.exe", "Microsoft", "Edge", "Application", "msedge.exe")
    if edge:
        return "Edge", edge
    raise FileNotFoundError("找不到 Chrome 或 Edge。请安装 Google Chrome 后再运行。")


def message_box(text: str, title: str = "雲雀 Hibari", error: bool = True) -> None:
    ctypes.windll.user32.MessageBoxW(None, text, title, 0x10 if error else 0x30)


def _newest_mtime(paths: list[Path]) -> float:
    newest = 0.0
    for p in paths:
        files = [p] if p.is_file() else (f for f in p.rglob("*") if f.is_file())
        newest = max([newest, *(f.stat().st_mtime for f in files)])
    return newest


def ensure_frontend_built() -> None:
    if not (FRONTEND / "src").exists():  # portable release: dist is prebuilt, no sources / Node
        return
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
            name, exe = find_browser()
            version = browser_version(exe)
            log.info("browser: %s %s (%s)", name, version, exe)
            if version is not None and version < MIN_CHROMIUM:
                message_box(
                    f"{name} 版本太旧（{version}），界面可能显示不正常。\n请更新 {name}，或安装最新版 Google Chrome。",
                    error=False,
                )
            chrome = subprocess.Popen(
                [
                    str(exe),
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
    except Exception as ex:
        log.exception("launcher failed")
        message_box(f"启动失败：{ex}\n\n详细信息见 {DATA / 'launcher.log'} 和 server.log")
        raise


if __name__ == "__main__":
    main()
