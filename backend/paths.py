"""Where Hibari's files live.

``ROOT`` is the app folder (sources, frontend/dist, mjbot_mortal). ``DATA`` holds
the user's files (settings, logs, avatars, drill results): ``ROOT/data`` by
default, or ``$HIBARI_DATA``. The macOS app bundle sets it to
``~/Library/Application Support/Hibari/data``, because an app bundle must not be
written to.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ["HIBARI_DATA"]).expanduser() if os.environ.get("HIBARI_DATA") else ROOT / "data"
