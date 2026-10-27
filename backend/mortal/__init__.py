"""In-process adapter for the vendored Mortal bot in ``mjbot_mortal/``.

``mjbot_mortal`` is not a package: ``model.py`` imports ``_libriichi_loader``
and ``libriichi`` as top-level modules. We put its directory on ``sys.path``
and load the matching prebuilt ``libriichi`` before importing ``model``.
"""
from __future__ import annotations

import re
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


_engines: dict[float, object] = {}


def sampling_engine(temperature: float):
    """A ``MortalEngine`` sharing the loaded network but sampling actions.

    Each decision samples from softmax(Q / temperature) over the legal
    actions. 0 means greedy (always the top action). 0.3 matches the
    probabilities shown in the hint panel (``meta_show`` uses T = 0.3).
    """
    if temperature <= 0:
        return get_engine()
    key = round(temperature, 3)
    if key not in _engines:
        m, base = _model_module(), get_engine()
        _engines[key] = m.MortalEngine(
            base.brain,
            base.dqn,
            is_oracle=False,
            version=base.version,
            device=base.device,
            enable_amp=False,
            enable_quick_eval=False,
            enable_rule_based_agari_guard=True,
            name=f"mortal-t{key}",
            boltzmann_epsilon=1.0,  # always sample
            boltzmann_temp=key,
            top_p=1.0,
        )
    return _engines[key]


def load_bot(seat: int, temperature: float = 0.0):
    """A fresh ``libriichi.mjai.Bot`` for ``seat``.

    Greedy bots share one engine; sampling bots share one per temperature.
    """
    if temperature <= 0:
        return _model_module().load_model(seat)
    return libriichi().mjai.Bot(sampling_engine(temperature), seat)


def get_engine():
    """The shared ``MortalEngine`` (loads ``mortal.pth`` on first call)."""
    return _model_module()._get_engine()


def new_player_state(seat: int):
    return libriichi().state.PlayerState(seat)


_HINT_TYPES = {
    "Dahai": "dahai", "Reach": "reach", "Chi": "chi", "Pon": "pon",
    "Daiminkan": "kan", "Ankan": "kan", "Kakan": "kan", "Kan": "kan",
    "Tsumo": "hora", "Ron": "hora", "Hora": "hora", "Ryukyoku": "ryukyoku", "Skip": "none",
}


def _parse_mahgen(s: str) -> list[str]:
    """``"68m|7m"`` -> ``["6m", "8m", "7m"]``; ``z`` = honors, ``0`` = red five."""
    tiles = []
    for digits, suit in re.findall(r"(\d+)([mpsz])", s):
        for d in digits:
            if suit == "z":
                tiles.append("ESWNPFC"[int(d) - 1])
            else:
                tiles.append(f"5{suit}r" if d == "0" else f"{d}{suit}")
    return tiles


def top_actions(meta: dict, state, k: int = 3) -> list[dict]:
    """Mortal's top-``k`` actions from a reaction's ``meta`` (q_values + mask_bits).

    ``state`` is the acting seat's ``PlayerState`` at the decision point.
    Rows look like ``{"type": "dahai", "label": "Dahai 5m", "tiles": ["5m"], "prob": 0.61}``;
    for calls, ``tiles`` is the consumed tiles followed by the called tile.
    """
    _model_module()
    import meta_show

    rows = []
    for item in meta_show.meta_to_top_show(meta, state, k=k).get("items", []):
        label = item["label"]
        rows.append(
            {
                "type": _HINT_TYPES.get(label.split()[0], "none"),
                "label": label,
                "tiles": item.get("pais") or _parse_mahgen(item.get("tiles", "")),
                "prob": float(item["value"].rstrip("%")) / 100,
            }
        )
    return rows
