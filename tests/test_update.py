"""设置 → 更新: the updater swaps a new package in without touching your data or private files."""
import subprocess
import sys
import time
from pathlib import Path

import pytest

from backend import update
from scripts import updater


def write(root: Path, files: dict[str, str]) -> None:
    for rel, text in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text, encoding="utf-8")


def tree(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): p.read_text(encoding="utf-8") for p in root.rglob("*") if p.is_file()}


OLD = {
    "Hibari.exe": "old exe",
    "VERSION": "0.1.3",
    "data/settings.json": "mine",
    "data/games/a.json.gz": "my log",
    "mjbot_mortal/mortal.pth": "weights",
    "mjbot_mortal/saki_avatars/a.jpg": "preset",
    "mjbot_mortal/libriichi.pyd": "old lib",
    "backend/gone.py": "stale",
    "backend/app.py": "old app",
    "runtime/python/old.dll": "old",
}
NEW = {
    "Hibari.exe": "new exe",
    "VERSION": "0.1.4",
    "data/settings.json": "seed",
    "mjbot_mortal/libriichi.pyd": "new lib",
    "backend/app.py": "new app",
    "runtime/python/new.dll": "new",
}
AFTER = {
    "Hibari.exe": "new exe",
    "VERSION": "0.1.4",
    "data/settings.json": "mine",
    "data/games/a.json.gz": "my log",
    "mjbot_mortal/mortal.pth": "weights",
    "mjbot_mortal/saki_avatars/a.jpg": "preset",
    "mjbot_mortal/libriichi.pyd": "new lib",
    "backend/app.py": "new app",
    "runtime/python/new.dll": "new",
}


@pytest.fixture
def install(tmp_path, monkeypatch):
    old, new = tmp_path / "app", tmp_path / "update" / "staged" / "Hibari"
    write(old, OLD)
    write(new, NEW)
    monkeypatch.setattr(updater, "LOG", tmp_path / "updater.log")
    return old, new, tmp_path / "update" / "previous"


def test_merge_keeps_data_and_private_files(install):
    old, new, backup = install
    journal = []
    updater.merge(new, old, backup, journal)
    assert tree(old) == AFTER


def test_undo_restores_the_old_install(install):
    old, new, backup = install
    journal = []
    updater.merge(new, old, backup, journal)
    updater.undo(journal)
    assert tree(old) == OLD


def test_updater_end_to_end(tmp_path):
    """As the launcher runs it: wait for a (finished) process, install, start the relaunch command."""
    old, new = tmp_path / "app", tmp_path / "update" / "staged" / "Hibari"
    write(old, OLD)
    write(new, NEW)
    done = subprocess.run([sys.executable, "-c", "pass"])
    gone = subprocess.Popen([sys.executable, "-c", "pass"])
    gone.wait()
    marker = tmp_path / "relaunched"
    script = Path(updater.__file__)
    subprocess.run(
        [sys.executable, "-I", str(script), str(gone.pid), str(old), str(new), str(tmp_path / "u.log"), "--",
         sys.executable, "-c", f"open({str(marker)!r}, 'w').close()"],
        check=True, timeout=60,
    )
    for _ in range(50):
        if marker.exists():
            break
        time.sleep(0.1)
    assert done.returncode == 0
    assert marker.exists()
    assert tree(old) == AFTER
    assert not (tmp_path / "update" / "staged").exists()


def test_versions_compare_numerically():
    assert update._vtuple("v0.1.10") > update._vtuple("0.1.9")
    assert update._vtuple("0.2.0") > update._vtuple("0.1.13")
    assert update._vtuple("0.1.3") == update._vtuple("v0.1.3")


def test_current_version_reads_pyproject_in_a_checkout():
    assert update.current_version()[0].isdigit()
    assert update.mode() == "git"
