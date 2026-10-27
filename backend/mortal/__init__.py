"""In-process adapter for the vendored Mortal bot in ``mjbot_mortal/``.

``mjbot_mortal`` is not a package: ``model.py`` imports ``_libriichi_loader``
and ``libriichi`` as top-level modules. We put its directory on ``sys.path``
and load the matching prebuilt ``libriichi`` before importing ``model``.
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import ModuleType

MORTAL_DIR = Path(__file__).resolve().parents[2] / "mjbot_mortal"

_model: ModuleType | None = None


def _model_module() -> ModuleType:
    global _model
    if _model is None:
        if str(MORTAL_DIR) not in sys.path:
            sys.path.insert(0, str(MORTAL_DIR))
        import _libriichi_loader

        _libriichi_loader.load()
        import model

        # Never delegate inference to the remote server, whatever
        # ot_settings.json / AKAGI_BOT_CONFIG say.
        model.ot_settings["online"] = False
        _model = model
    return _model


def libriichi() -> ModuleType:
    _model_module()
    import libriichi as lib

    return lib


def load_bot(seat: int):
    """A fresh ``libriichi.mjai.Bot`` for ``seat``; all bots share one engine."""
    return _model_module().load_model(seat)


def get_engine():
    """The shared ``MortalEngine`` (loads ``mortal.pth`` on first call)."""
    return _model_module()._get_engine()


def new_player_state(seat: int):
    return libriichi().state.PlayerState(seat)
