"""User settings and saved game logs.

Logs are plain ``.json.gz`` mjai files in the configured folder; the folder
is the source of truth (files copied in show up, deleted files disappear).
Metadata is read from the logs and cached by (path, mtime).
"""
from __future__ import annotations

import gzip
import json
import re
import tempfile
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

from backend import mortal

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
SETTINGS_FILE = DATA / "settings.json"
_ID = re.compile(r"^[0-9A-Za-z_-]{1,64}$")


# -- settings ------------------------------------------------------------------


@dataclass
class Settings:
    player_name: str = "You"
    log_dir: str = str(DATA / "games")
    default_length: str = "hanchan"  # hanchan | tonpuu
    think_min: float = 1.0  # bots' thinking time per decision, seconds
    think_max: float = 3.0
    # sampling temperature of Mortal-A/B/C (0 = always the top action)
    bot_temps: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])
    bot_names: list[str] = field(default_factory=lambda: ["Mortal-A", "Mortal-B", "Mortal-C"])
    auto_temp: float = 0.0  # AI 代打 sampling temperature (Mortal playing your seat)
    felt: str = "green"  # table cloth preset, or "custom" (uploaded image)
    background: str = "dark"  # page background preset, or "custom"
    # uploaded asset name -> version (unix ms), for cache busting; managed by save_asset
    assets: dict[str, int] = field(default_factory=dict)

    @property
    def log_path(self) -> Path:
        p = Path(self.log_dir)
        return p if p.is_absolute() else ROOT / p


_settings_lock = threading.Lock()


def load_settings() -> Settings:
    try:
        raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return Settings()
    known = {k: v for k, v in raw.items() if k in Settings.__dataclass_fields__}
    return Settings(**known)


def save_settings(s: Settings) -> Settings:
    with _settings_lock:
        DATA.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(json.dumps(asdict(s), ensure_ascii=False, indent=2), encoding="utf-8")
    return s


# -- assets (avatars, table cloth, background) -----------------------------------

ASSET_DIR = DATA / "assets"
# name -> path relative to ASSET_DIR (without extension)
ASSETS = {
    "avatar_player": "avatars/player",
    "avatar_ai1": "avatars/ai1",
    "avatar_ai2": "avatars/ai2",
    "avatar_ai3": "avatars/ai3",
    "felt": "felt",
    "background": "background",
}
IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
MAX_ASSET_BYTES = 8 * 1024 * 1024


def asset_path(name: str) -> Path | None:
    """The stored file for an asset, or None."""
    base = ASSET_DIR / ASSETS[name]
    for ext in IMAGE_TYPES.values():
        if (p := base.with_suffix(ext)).exists():
            return p
    return None


def save_asset(name: str, data: bytes, content_type: str) -> Settings:
    if name not in ASSETS:
        raise KeyError(name)
    if content_type not in IMAGE_TYPES:
        raise ValueError(f"unsupported image type {content_type}")
    if not data or len(data) > MAX_ASSET_BYTES:
        raise ValueError("image is empty or too large")
    if old := asset_path(name):
        old.unlink()
    path = (ASSET_DIR / ASSETS[name]).with_suffix(IMAGE_TYPES[content_type])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    s = load_settings()
    s.assets[name] = int(time.time() * 1000)
    return save_settings(s)


def delete_asset(name: str) -> Settings:
    if name not in ASSETS:
        raise KeyError(name)
    if old := asset_path(name):
        old.unlink()
    s = load_settings()
    s.assets.pop(name, None)
    return save_settings(s)


# -- logs ----------------------------------------------------------------------


@dataclass
class GameMeta:
    id: str
    started_at: str  # ISO 8601
    length: str
    names: list[str]
    scores: list[int]
    human: int  # the human's seat
    rank: int  # the human's rank
    point: float  # the human's final pt (uma + oka)
    kyoku: int
    finished: bool
    size: int = 0
    review: dict | None = None  # summary of the Mortal review, if one was run
    autoplay: str = "none"  # none | partial (AI 代打 for some decisions) | full (batch)


_meta_cache: dict[Path, tuple[tuple[float, float], GameMeta]] = {}
UMA = (20, 10, -10, -20)


def log_file(settings: Settings, game_id: str) -> Path:
    if not _ID.match(game_id):
        raise ValueError("bad game id")
    return settings.log_path / f"{game_id}.json.gz"


def read_events(path: Path) -> list[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def review_file(log: Path) -> Path:
    return log.with_name(log.name.removesuffix(".json.gz") + ".review.json")


def read_review(log: Path) -> dict | None:
    try:
        return json.loads(review_file(log).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def save_review(log: Path, review: dict) -> None:
    review_file(log).write_text(json.dumps(review, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    _meta_cache.pop(log, None)


def _meta(path: Path) -> GameMeta | None:
    rf = review_file(path)
    mtime = (path.stat().st_mtime, rf.stat().st_mtime if rf.exists() else 0.0)
    cached = _meta_cache.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    try:
        events = read_events(path)
    except (OSError, ValueError, EOFError):
        return None
    if not events or events[0].get("type") != "start_game":
        return None
    start = events[0]
    end = next((e for e in reversed(events) if e["type"] == "end_game"), None)
    scores = (end or {}).get("scores")
    if scores is None:  # older logs: last known scores
        last = next((e for e in reversed(events) if e["type"] == "start_kyoku"), None)
        scores = last["scores"] if last else [25000] * 4
    human = int(start.get("human", 0))  # older logs: always seat 0
    order = sorted(range(4), key=lambda s: (-scores[s], s))
    rank = order.index(human) + 1
    started = start.get("started_at") or datetime.fromtimestamp(mtime[0]).isoformat(timespec="seconds")
    meta = GameMeta(
        id=path.name.removesuffix(".json.gz"),
        started_at=started,
        length=start.get("length", "hanchan"),
        names=start.get("names", ["?"] * 4),
        scores=scores,
        human=human,
        rank=rank,
        point=round((scores[human] - 30000) / 1000 + UMA[rank - 1] + (20 if rank == 1 else 0), 1),
        kyoku=len({(e.get("bakaze"), e.get("kyoku"), e.get("honba")) for e in events if e["type"] == "start_kyoku"}),
        finished=end is not None,
        size=path.stat().st_size,
        review=(read_review(path) or {}).get("summary"),
        autoplay=start.get("autoplay") or ("partial" if (end or {}).get("auto_decisions") else "none"),
    )
    _meta_cache[path] = (mtime, meta)
    return meta


def list_games(settings: Settings) -> list[GameMeta]:
    folder = settings.log_path
    if not folder.is_dir():
        return []
    metas = [m for p in folder.glob("*.json.gz") if (m := _meta(p))]
    return sorted(metas, key=lambda m: m.started_at, reverse=True)


def delete_game(settings: Settings, game_id: str) -> bool:
    path = log_file(settings, game_id)
    if not path.exists():
        return False
    path.unlink()
    review_file(path).unlink(missing_ok=True)
    _meta_cache.pop(path, None)
    return True


# -- stats ---------------------------------------------------------------------

_ME = "__trainer_human__"

# (key, label) of libriichi Stat attributes shown in the UI, grouped
STAT_FIELDS = {
    "overview": ["game", "round", "avg_rank", "rank_1_rate", "rank_2_rate", "rank_3_rate", "rank_4_rate", "tobi_rate"],
    "win": ["agari_rate", "avg_point_per_agari", "avg_agari_jun", "agari_rate_after_riichi", "agari_rate_after_fuuro", "agari_rate_as_oya", "dama_agari", "yakuman_rate"],
    "dealin": ["houjuu_rate", "avg_point_per_houjuu", "avg_houjuu_jun", "houjuu_rate_after_riichi", "houjuu_rate_after_fuuro"],
    "style": ["riichi_rate", "fuuro_rate", "avg_fuuro_num", "avg_riichi_jun", "chasing_riichi_rate", "riichi_chased_rate", "ryukyoku_rate", "avg_point_per_round"],
}


def compute_stats(settings: Settings, game_ids: list[str] | None = None) -> dict:
    """libriichi ``Stat`` for the human seat over the selected (default: all) games.

    The human's name is replaced with a fixed token in temporary copies,
    because ``Stat.from_dir`` matches players by name (renames would split
    the stats).
    """
    # default selection: your own games (not fully AI-played ones)
    games = [
        g
        for g in list_games(settings)
        if g.finished and (g.id in game_ids if game_ids is not None else g.autoplay != "full")
    ]
    out: dict = {"games": [asdict(g) for g in games]}
    if not games:
        out["stat"] = None
        return out
    with tempfile.TemporaryDirectory() as tmp:
        for g in games:
            events = read_events(log_file(settings, g.id))
            names = list(events[0]["names"])
            names[g.human] = _ME
            events[0] = {**events[0], "names": names}
            with gzip.open(Path(tmp) / f"{g.id}.json.gz", "wt", encoding="utf-8") as f:
                for ev in events:
                    f.write(json.dumps(ev, separators=(",", ":"), ensure_ascii=False) + "\n")
        stat = mortal.libriichi().stat.Stat.from_dir(tmp, _ME)
    out["stat"] = {k: _num(getattr(stat, k)) for group in STAT_FIELDS.values() for k in group}
    # final pt (uma + oka) per game, from our own metadata
    out["stat"]["avg_point"] = round(sum(g.point for g in games) / len(games), 2)
    out["stat"]["total_point"] = round(sum(g.point for g in games), 1)
    out["groups"] = STAT_FIELDS
    return out


def _num(v):
    if isinstance(v, float):
        return None if v != v else round(v, 4)  # NaN (no samples) -> null
    return v

