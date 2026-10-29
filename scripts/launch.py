"""Desktop-style launcher: backend + Chrome app window, no browser chrome.

1. Rebuilds ``frontend/dist`` if the frontend sources are newer.
2. Starts the backend (which also serves the built UI) on a free port.
3. Opens Chrome in ``--app`` mode with its own profile, so the window behaves
   like a separate program (own taskbar entry, no address bar / tabs).
   Without Chrome it uses Edge or Chromium (same flags); with none of them,
   the default browser (then the backend runs until the launcher is stopped).
4. When that window is closed, stops the backend. On macOS the browser keeps
   running after its last window closes: quit it (Cmd+Q) to stop Hibari.
5. 设置 → 更新 → 重启 (``backend/update.py`` writes ``data/update/restart.json``):
   stops the window and the backend, then starts Hibari again. With a
   downloaded package it first hands over to ``scripts/updater.py``, run from a
   copy of the Python runtime so that no file being replaced is in use.

Windows: ``start.cmd`` (no console) or ``Hibari.exe`` in the portable release.
macOS: ``start.command``; Linux: ``start.sh``. Or ``uv run python -m scripts.launch``.
Output goes to ``data/launcher.log``; failures also show a message box.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

from backend.paths import DATA, ROOT

FRONTEND = ROOT / "frontend"
NODE_DIR = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "nodejs"  # Windows: portable Node
IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
NO_WINDOW = subprocess.CREATE_NO_WINDOW if IS_WIN else 0

log = logging.getLogger("launcher")


# the UI (Tailwind 4) needs Chromium 111+
MIN_CHROMIUM = 111


def _find_exe(app_paths_name: str, *rel: str) -> Path | None:
    """Windows: a browser from the App Paths registry key, or its default install folders."""
    import winreg

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


def parse_major(text: str) -> int | None:
    """Major version from ``--version`` output such as "Google Chrome 141.0.7390.54"."""
    for word in text.split():
        head = word.split(".")[0]
        if head.isdigit() and "." in word:
            return int(head)
    return None


def browser_version(exe: Path) -> int | None:
    """Major version of a Chromium browser (None if unknown)."""
    if IS_WIN:  # chrome.exe --version opens a window; the version folder next to it tells
        majors = [int(d.name.split(".")[0]) for d in exe.parent.iterdir() if d.is_dir() and d.name.split(".")[0].isdigit()]
        return max(majors) if majors else None
    try:
        out = subprocess.run([str(exe), "--version"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return parse_major(out)


# (name, macOS app executable / Linux command) in order of preference
MAC_BROWSERS = [
    ("Chrome", "Google Chrome.app/Contents/MacOS/Google Chrome"),
    ("Edge", "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    ("Chromium", "Chromium.app/Contents/MacOS/Chromium"),
]
# where macOS apps are installed (a function, so tests can point it elsewhere)
def mac_app_dirs() -> list[Path]:
    return [Path("/Applications"), Path.home() / "Applications"]


LINUX_BROWSERS = [
    ("Chrome", "google-chrome"),
    ("Chrome", "google-chrome-stable"),
    ("Edge", "microsoft-edge"),
    ("Edge", "microsoft-edge-stable"),
    ("Chromium", "chromium"),
    ("Chromium", "chromium-browser"),
]


def find_browser() -> tuple[str, Path] | None:
    """The Chromium browser to open the app window with: Chrome, else Edge, else Chromium."""
    if IS_WIN:
        chrome = _find_exe("chrome.exe", "Google", "Chrome", "Application", "chrome.exe")
        if chrome:
            return "Chrome", chrome
        edge = _find_exe("msedge.exe", "Microsoft", "Edge", "Application", "msedge.exe")
        return ("Edge", edge) if edge else None
    if IS_MAC:
        for name, rel in MAC_BROWSERS:
            for apps in mac_app_dirs():
                if (p := apps / rel).exists():
                    return name, p
        return None
    for name, cmd in LINUX_BROWSERS:
        if p := shutil.which(cmd):
            return name, Path(p)
    return None


def message_box(text: str, title: str = "雲雀 Hibari", error: bool = True) -> None:
    """Show a message to someone who may have no console (double-clicked launcher)."""
    print(text, file=sys.stderr)
    try:
        if IS_WIN:
            import ctypes

            ctypes.windll.user32.MessageBoxW(None, text, title, 0x10 if error else 0x30)
        elif IS_MAC:
            esc = text.replace("\\", "\\\\").replace('"', '\\"')
            icon = "stop" if error else "caution"
            subprocess.run(["osascript", "-e", f'display dialog "{esc}" with title "{title}" buttons {{"OK"}} with icon {icon}'], timeout=600)
        elif shutil.which("zenity"):
            subprocess.run(["zenity", "--error" if error else "--warning", f"--title={title}", f"--text={text}"], timeout=600)
    except Exception:  # the message is in the log and on stderr anyway
        log.exception("message box failed")


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


def seed_data() -> None:
    """First run with data outside the app folder (macOS app): start from the bundled data/ (AI avatars)."""
    seed = ROOT / "data"
    if DATA != seed and not DATA.exists() and seed.is_dir():
        shutil.copytree(seed, DATA)


def calm_profile() -> None:
    """The app window is ended with a kill on restart: mark the profile as closed cleanly, so Chrome
    doesn't offer to restore the session."""
    prefs = DATA / "chrome-app" / "Default" / "Preferences"
    try:
        data = json.loads(prefs.read_text(encoding="utf-8"))
        data.setdefault("profile", {}).update(exit_type="Normal", exited_cleanly=True)
        prefs.write_text(json.dumps(data), encoding="utf-8")
    except (OSError, ValueError):
        pass


def wait_or_restart(proc: subprocess.Popen) -> dict | None:
    """Wait for ``proc`` to end; a restart request (from 设置 → 更新) ends the wait early."""
    from backend.update import RESTART_FLAG

    while proc.poll() is None:
        if RESTART_FLAG.exists():
            try:
                req = json.loads(RESTART_FLAG.read_text(encoding="utf-8"))
            except ValueError:
                req = {}
            RESTART_FLAG.unlink(missing_ok=True)
            log.info("restart requested: %s", req)
            return req
        time.sleep(0.5)
    return None


def restart(req: dict) -> None:
    """Start Hibari again (detached), through the updater when a package is staged."""
    from backend import update

    detached = (
        {"creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP}
        if IS_WIN
        else {"start_new_session": True}
    )
    if not req.get("apply"):
        subprocess.Popen([sys.executable, "-m", "scripts.launch"], cwd=ROOT, close_fds=True, **detached)
        return
    # a copy of the interpreter and its standard library (no site-packages): the updater replaces runtime/
    runner = update.UPDATE / "runner"
    shutil.rmtree(runner, ignore_errors=True)
    skip = shutil.ignore_patterns("site-packages", "__pycache__", "test", "tests", "idlelib", "tkinter", "turtledemo")
    shutil.copytree(Path(sys.base_prefix), runner, ignore=skip, symlinks=True)
    py = runner / ("pythonw.exe" if IS_WIN else f"bin/python{sys.version_info.major}.{sys.version_info.minor}")
    script = update.UPDATE / "updater.py"
    shutil.copy2(ROOT / "scripts" / "updater.py", script)
    old, new = update.app_root_for_update()
    cmd = [str(py), "-I", str(script), str(os.getpid()), str(old), str(new), str(update.UPDATE / "updater.log"), "--",
           *update.relaunch_command()]
    log.info("handing over to the updater: %s", cmd)
    subprocess.Popen(cmd, cwd=update.UPDATE, close_fds=True, **detached)


def check_weights() -> None:
    from backend import mortal

    weights = mortal.MORTAL_DIR / "mortal.pth"
    if not weights.exists():
        log.warning("weights missing: %s", weights)
        message_box(
            f"没有找到 Mortal 模型权重：\n{weights}\n\n请把 mortal.pth 放到这个位置后重新启动。"
            "在此之前只能使用听牌练习、点数计算等不需要 AI 的功能。",
            error=False,
        )


def main() -> None:
    seed_data()
    DATA.mkdir(parents=True, exist_ok=True)
    from backend.update import RESTART_FLAG

    RESTART_FLAG.unlink(missing_ok=True)  # a request left over from a run that ended otherwise
    shutil.rmtree(RESTART_FLAG.parent / "runner", ignore_errors=True)  # the updater's interpreter, done with
    calm_profile()
    logging.basicConfig(
        filename=DATA / "launcher.log",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    try:
        check_weights()
        ensure_frontend_built()
        port = free_port()
        python = Path(sys.executable)
        if python.name.lower() == "pythonw.exe":  # Windows: keep the server's own output going to the log
            python = python.with_name("python.exe")
        server_log = open(DATA / "server.log", "a", encoding="utf-8")
        server = subprocess.Popen(
            [str(python), "-m", "uvicorn", "backend.server.app:app", "--port", str(port)],
            cwd=ROOT,
            env={**os.environ, "HIBARI_LAUNCHER": "1"},  # the update page may offer a restart
            stdout=server_log,
            stderr=subprocess.STDOUT,
            creationflags=NO_WINDOW,
        )
        try:
            url = f"http://127.0.0.1:{port}/"
            wait_ready(url + "api/health", server)
            log.info("backend ready at %s", url)
            found = find_browser()
            if found is None:
                # no Chromium browser: the default one, without app mode; runs until stopped
                log.info("no Chromium browser found, opening %s in the default browser", url)
                webbrowser.open(url)
                message_box(
                    f"没有找到 Chrome / Edge / Chromium，已用默认浏览器打开 {url}\n"
                    "界面在 Chromium 内核浏览器里效果最好。结束时关闭启动 Hibari 的终端窗口即可。",
                    error=False,
                )
                req = wait_or_restart(server)
                if req is not None:
                    server.terminate()
                    server.wait(timeout=10)
                    restart(req)
                return
            name, exe = found
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
            # own profile: returns when the app window is closed, or on a restart request
            req = wait_or_restart(chrome)
            if req is None:
                log.info("window closed")
            else:
                chrome.terminate()
                server.terminate()
                for p in (chrome, server):
                    try:
                        p.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        p.kill()
                restart(req)
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
