"""Updates from GitHub (设置 → 更新).

Two kinds of installs:

* ``release``: a portable package (``Hibari.exe`` / ``Hibari.app`` / ``start.sh``). ``check`` reads the
  latest GitHub release; ``download`` fetches this platform's package into ``DATA/update`` and unpacks it
  there; ``restart`` asks the launcher to stop, after which ``scripts/updater.py`` (run from a copy of the
  Python runtime, so no file of the app is in use) swaps the new files in and starts Hibari again.
* ``git``: a source checkout (``start.cmd`` etc.). ``check`` fetches and counts the commits behind;
  ``pull`` runs ``git pull --ff-only``; ``restart`` restarts the launcher, which rebuilds the UI when the
  sources are newer.

Your data (``DATA``: settings, logs, avatars, drill results) is never touched, and in ``mjbot_mortal`` the
files the package doesn't have (``mortal.pth``, preset avatars) stay.
"""
from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import tarfile
import threading
import tomllib
import urllib.request
import zipfile
from pathlib import Path

from backend.paths import DATA, ROOT

REPO = "Ehwartz/hibari"
# HIBARI_UPDATE_API: another release endpoint (tests use a local server)
LATEST = os.environ.get("HIBARI_UPDATE_API") or f"https://api.github.com/repos/{REPO}/releases/latest"
UPDATE = DATA / "update"
STAGED = UPDATE / "staged"
RESTART_FLAG = UPDATE / "restart.json"


def long_path(p: Path) -> Path:
    """Windows: the extended-length form, so that the runtime's deep package paths may pass 260 characters."""
    s = str(p.resolve())
    return Path("\\\\?\\" + s) if os.name == "nt" and not s.startswith("\\\\") else Path(s)


def current_version() -> str:
    """The release package carries ``VERSION``; a checkout has ``pyproject.toml``."""
    if (ROOT / "VERSION").exists():
        return (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    try:
        return tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]["version"]
    except (OSError, KeyError, tomllib.TOMLDecodeError):
        return "0"


def mode() -> str:
    return "git" if (ROOT / ".git").exists() else "release"


def _vtuple(v: str) -> tuple[int, ...]:
    out = []
    for part in v.lstrip("v").split("."):
        digits = "".join(c for c in part if c.isdigit())
        out.append(int(digits) if digits else 0)
    return tuple(out)


def _asset_suffix() -> str:
    if sys.platform == "win32":
        return "-win64.zip"
    if sys.platform == "darwin":
        return "-macos-arm64.zip"
    return "-linux-x86_64.tar.gz"


def _git(*args: str, timeout: float = 60) -> str:
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=timeout,
                       creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip() or f"git {args[0]} failed")
    return r.stdout.strip()


# -- state shared with the API ---------------------------------------------------------------------------

_lock = threading.Lock()
_state: dict = {"phase": "idle"}  # idle | downloading | ready | error


def status() -> dict:
    with _lock:
        s = dict(_state)
    if s["phase"] == "idle" and (STAGED / "manifest.json").exists():
        s = {"phase": "ready", **json.loads((STAGED / "manifest.json").read_text(encoding="utf-8"))}
    return {"mode": mode(), "current": current_version(), **s}


def _set(**kw) -> None:
    with _lock:
        _state.clear()
        _state.update(kw)


def check() -> dict:
    """What is available. Release: the latest GitHub release; git: commits on the upstream branch."""
    if mode() == "git":
        _git("fetch", "--quiet", timeout=120)
        behind = int(_git("rev-list", "--count", "HEAD..@{u}") or 0)
        log = _git("log", "--format=%s", "-n", "20", "HEAD..@{u}").splitlines() if behind else []
        return {"mode": "git", "current": current_version(), "newer": behind > 0, "behind": behind, "notes": "\n".join(log)}
    req = urllib.request.Request(LATEST, headers={"Accept": "application/vnd.github+json", "User-Agent": "Hibari"})
    with urllib.request.urlopen(req, timeout=20) as r:
        rel = json.load(r)
    latest = rel["tag_name"].lstrip("v")
    asset = next((a for a in rel.get("assets", []) if a["name"].endswith(_asset_suffix())), None)
    return {
        "mode": "release",
        "current": current_version(),
        "latest": latest,
        "newer": _vtuple(latest) > _vtuple(current_version()),
        "notes": rel.get("body") or "",
        "asset": asset and {"name": asset["name"], "size": asset["size"], "url": asset["browser_download_url"]},
    }


def pull() -> str:
    """git: fast-forward to the upstream branch (refuses when local commits diverge)."""
    return _git("pull", "--ff-only", timeout=300)


# -- release download -------------------------------------------------------------------------------------

def _extract_zip(path: Path, dest: Path) -> None:
    """Like ZipFile.extractall, but keeps the Unix permissions and symlinks a macOS / Linux zip carries."""
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            target = dest / info.filename
            mode_bits = info.external_attr >> 16
            if stat.S_ISLNK(mode_bits):
                target.parent.mkdir(parents=True, exist_ok=True)
                os.symlink(z.read(info).decode(), target)
                continue
            z.extract(info, dest)
            if mode_bits and not info.is_dir() and os.name != "nt":
                os.chmod(target, stat.S_IMODE(mode_bits))


def _download(asset: dict, version: str) -> None:
    try:
        shutil.rmtree(long_path(STAGED), ignore_errors=True)
        UPDATE.mkdir(parents=True, exist_ok=True)
        part = UPDATE / (asset["name"] + ".part")
        req = urllib.request.Request(asset["url"], headers={"User-Agent": "Hibari"})
        with urllib.request.urlopen(req, timeout=60) as r, open(part, "wb") as f:
            total = int(r.headers.get("Content-Length") or asset["size"])
            done = 0
            while chunk := r.read(1 << 20):
                f.write(chunk)
                done += len(chunk)
                _set(phase="downloading", version=version, done=done, total=total)
        _set(phase="unpacking", version=version)
        tmp = long_path(UPDATE / "unpack")
        shutil.rmtree(tmp, ignore_errors=True)
        if asset["name"].endswith(".zip"):
            _extract_zip(part, tmp)
        else:
            with tarfile.open(part) as t:
                t.extractall(tmp, filter="tar")
        part.unlink()
        if not (tmp / "Hibari").is_dir():
            raise RuntimeError("压缩包里没有 Hibari 文件夹")
        (tmp / "manifest.json").write_text(json.dumps({"version": version}), encoding="utf-8")
        tmp.rename(long_path(STAGED))
        _set(phase="idle")  # status() reports the staged package as ready
    except Exception as ex:  # noqa: BLE001 - shown in the settings page
        _set(phase="error", error=str(ex))


def download(info: dict) -> None:
    if not info.get("asset"):
        raise RuntimeError("这个版本没有当前系统的安装包")
    if status()["phase"] in ("downloading", "unpacking"):
        return
    _set(phase="downloading", version=info["latest"], done=0, total=info["asset"]["size"])
    threading.Thread(target=_download, args=(info["asset"], info["latest"]), daemon=True).start()


# -- restart ----------------------------------------------------------------------------------------------

def request_restart() -> dict:
    """Ask the launcher (it polls for this file) to stop and start again, applying a staged package."""
    apply = mode() == "release" and (STAGED / "manifest.json").exists()
    UPDATE.mkdir(parents=True, exist_ok=True)
    RESTART_FLAG.write_text(json.dumps({"apply": apply}), encoding="utf-8")
    return {"apply": apply, "launcher": os.environ.get("HIBARI_LAUNCHER") == "1"}


def app_root_for_update() -> tuple[Path, Path]:
    """(installed root, new root) for the updater: the app folder, or the whole bundle on macOS."""
    new_top = STAGED / "Hibari"
    if sys.platform == "darwin" and ROOT.parent.name == "Resources":
        return ROOT.parents[2], new_top / "Hibari.app"
    return ROOT, new_top


def relaunch_command() -> list[str]:
    """How to start Hibari again after an update."""
    if sys.platform == "win32":
        return [str(ROOT / "Hibari.exe")]
    if sys.platform == "darwin" and ROOT.parent.name == "Resources":
        return ["open", "-n", str(ROOT.parents[2])]
    return [str(ROOT / "start.sh")]

