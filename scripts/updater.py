"""Swap a downloaded Hibari package into the installed one, then start Hibari again.

Started by the launcher after it has stopped the app, from a copy of the Python runtime (standard
library only), so that no file being replaced is in use:

    python updater.py <launcher pid> <installed root> <new root> <log file> -- <relaunch command...>

It waits for the launcher to exit, then merges <new root> into <installed root>:

* ``data`` is skipped: your settings, logs, avatars and drill results stay as they are;
* ``runtime``, ``backend``, ``scripts`` and ``frontend`` are replaced as a whole (no stale files);
* everything else is merged file by file, so files only you have (``mjbot_mortal/mortal.pth``, preset
  avatars) stay.

On failure the old files that were already moved aside are put back where possible. Hibari is started
again either way; the log tells what happened.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

KEEP = {"data"}
REPLACE = {"runtime", "backend", "scripts", "frontend"}


def long_path(p: Path) -> Path:
    """Windows: the extended-length form, so that the runtime's deep package paths may pass 260 characters."""
    s = str(p.resolve())
    return Path("\\\\?\\" + s) if os.name == "nt" and not s.startswith("\\\\") else Path(s)


def log(msg: str) -> None:
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")


def wait_exit(pid: int, timeout: float = 60) -> None:
    end = time.time() + timeout
    if os.name == "nt":
        import ctypes

        SYNCHRONIZE = 0x00100000
        h = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, pid)
        if h:
            ctypes.windll.kernel32.WaitForSingleObject(h, int(timeout * 1000))
            ctypes.windll.kernel32.CloseHandle(h)
        time.sleep(1.5)  # let its children (server, browser) release their files too
        return
    while time.time() < end:
        try:
            os.kill(pid, 0)
        except OSError:
            break
        time.sleep(0.3)
    time.sleep(1)


def retry(f, *args, tries: int = 20):
    """Windows may hold a file a moment after its process ended (antivirus, indexer): retry."""
    for i in range(tries):
        try:
            return f(*args)
        except OSError:
            if i == tries - 1:
                raise
            time.sleep(0.5)


def merge(new: Path, old: Path, backup: Path, journal: list[tuple[Path, Path | None]], rel: str = "") -> None:
    """Move <new>'s entries into <old>; replaced ones go to <backup>. ``journal`` records (installed path,
    its backup or None) for undoing."""
    old.mkdir(parents=True, exist_ok=True)
    for item in sorted(new.iterdir()):
        name = f"{rel}{item.name}"
        target = old / item.name
        if not rel and item.name in KEEP:
            continue
        if item.is_dir() and not item.is_symlink() and item.name not in REPLACE and target.is_dir():
            merge(item, target, backup / item.name, journal, name + "/")
            continue
        saved = None
        if target.exists() or target.is_symlink():
            backup.mkdir(parents=True, exist_ok=True)
            saved = backup / item.name
            retry(shutil.move, str(target), str(saved))
        journal.append((target, saved))
        retry(shutil.move, str(item), str(target))
        log(f"installed {name}")


def undo(journal: list[tuple[Path, Path | None]]) -> None:
    for target, saved in reversed(journal):
        try:
            if target.is_dir() and not target.is_symlink():
                shutil.rmtree(target)
            elif target.exists() or target.is_symlink():
                target.unlink()
            if saved is not None:
                shutil.move(str(saved), str(target))
        except OSError as ex:
            log(f"could not restore {target}: {ex}")


def main() -> None:
    global LOG
    sep = sys.argv.index("--")
    pid, LOG = int(sys.argv[1]), Path(sys.argv[4])
    old, new = long_path(Path(sys.argv[2])), long_path(Path(sys.argv[3]))  # deep runtime paths on Windows
    relaunch = sys.argv[sep + 1 :]
    log(f"waiting for {pid}; {new} -> {old}")
    wait_exit(pid)
    backup = new.parent.parent / "previous"
    shutil.rmtree(backup, ignore_errors=True)
    journal: list[tuple[Path, Path | None]] = []
    try:
        merge(new, old, backup, journal)
        log("update installed")
        shutil.rmtree(new.parent.parent / "staged", ignore_errors=True)
        shutil.rmtree(backup, ignore_errors=True)
    except Exception as ex:  # noqa: BLE001
        log(f"update failed: {ex!r}; restoring")
        undo(journal)
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS if os.name == "nt" else 0
    subprocess.Popen(relaunch, cwd=sys.argv[2] if Path(sys.argv[2]).is_dir() else str(Path(sys.argv[2]).parent), creationflags=flags, close_fds=True,
                     start_new_session=os.name != "nt")
    log(f"started {relaunch}")


LOG = Path("updater.log")

if __name__ == "__main__":
    main()
