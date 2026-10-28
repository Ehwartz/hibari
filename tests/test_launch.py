"""Launcher browser discovery on each OS (the macOS / Linux branches are simulated)."""
from pathlib import Path

import pytest

import scripts.launch as launch


def test_parse_major():
    assert launch.parse_major("Google Chrome 141.0.7390.54 ") == 141
    assert launch.parse_major("Chromium 120.0.6099.71 built on Debian 12") == 120
    assert launch.parse_major("Microsoft Edge 139.0.3405.86") == 139
    assert launch.parse_major("no version here") is None


@pytest.fixture
def mac(monkeypatch, tmp_path):
    monkeypatch.setattr(launch, "IS_WIN", False)
    monkeypatch.setattr(launch, "IS_MAC", True)
    monkeypatch.setattr(launch, "mac_app_dirs", lambda: [tmp_path / "Applications"])
    return tmp_path


def test_mac_prefers_chrome_then_edge_then_chromium(mac):
    assert launch.find_browser() is None
    for name, rel in reversed(launch.MAC_BROWSERS):  # install in reverse order of preference
        exe = mac / "Applications" / rel
        exe.parent.mkdir(parents=True)
        exe.touch()
        assert launch.find_browser() == (name, exe)


def test_linux_uses_commands_on_path(monkeypatch):
    monkeypatch.setattr(launch, "IS_WIN", False)
    monkeypatch.setattr(launch, "IS_MAC", False)
    installed = {"chromium": "/usr/bin/chromium", "microsoft-edge-stable": "/usr/bin/microsoft-edge-stable"}
    monkeypatch.setattr(launch.shutil, "which", lambda cmd: installed.get(cmd))
    assert launch.find_browser() == ("Edge", Path("/usr/bin/microsoft-edge-stable"))
    installed.pop("microsoft-edge-stable")
    assert launch.find_browser() == ("Chromium", Path("/usr/bin/chromium"))
    installed.clear()
    assert launch.find_browser() is None
