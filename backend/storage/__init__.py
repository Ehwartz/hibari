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
from backend.paths import DATA, ROOT
SETTINGS_FILE = DATA / "settings.json"
_ID = re.compile(r"^[0-9A-Za-z_-]{1,64}$")


# -- settings ------------------------------------------------------------------


@dataclass
class Settings:
    player_name: str = "You"
    log_dir: str = "data/games"  # relative: to the folder holding data/ (the app folder by default)
    default_length: str = "hanchan"  # hanchan | tonpuu
    think_min: float = 1.0  # bots' thinking time per decision, seconds
    think_max: float = 3.0
    # sampling temperature of Mortal-A/B/C (0 = always the top action)
    bot_temps: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])
    bot_names: list[str] = field(default_factory=lambda: list(DEFAULT_BOT_NAMES))
    # how a game's pt is computed (see game_point): "score" = points + uma, "tenhou" = Tenhou dan pt
    pt_mode: str = "score"
    pt_dan: int = 7  # Tenhou dan (1 = 初段 … 10 = 十段): sets the 4th-place loss
    ai_name: str = "Mortal"  # display name of the AI (hints: "<name> 推荐", reviews, …)
    bot_dir: str = "mjbot_mortal"  # AI bot folder (Akagi Mortal layout); takes effect after a restart
    auto_temp: float = 0.0  # AI 代打 sampling temperature (Mortal playing your seat)
    sound_tiles: float = 0.7  # volume of the tile clacks (0 = off)
    sound_voice: float = 0.8  # volume of the call / riichi / win voices (0 = off)
    felt: str = "green"  # table cloth preset, or "custom" (uploaded image)
    background: str = "dark"  # page background preset, or "custom"
    # uploaded asset name -> version (unix ms), for cache busting; managed by save_asset
    assets: dict[str, int] = field(default_factory=dict)

    @property
    def log_path(self) -> Path:
        p = Path(self.log_dir)
        return p if p.is_absolute() else DATA.parent / p


_settings_lock = threading.Lock()


DEFAULT_BOT_NAMES = ("AI-A", "AI-B", "AI-C")


def load_settings() -> Settings:
    try:
        raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return Settings()
    known = {k: v for k, v in raw.items() if k in Settings.__dataclass_fields__}
    return Settings(**known)


def bot_dir_path(s: Settings) -> Path:
    p = Path(s.bot_dir)
    return p if p.is_absolute() else ROOT / p


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


def game_point(scores: list[int], rank: int, seat: int, length: str, s: Settings) -> float:
    """pt of one finished game for ``seat`` under the configured rule.

    score:  (points - 30000) / 1000 + uma 20/10/-10/-20 + oka 20 for 1st (same for both lengths)
    tenhou: Tenhou 鳳凰卓 dan pt, rank only — hanchan +90/+45/0/-(15·dan+15),
            tonpuu +60/+30/0/-(10·dan+10) (tonpuu is 2/3 of hanchan)
    """
    if s.pt_mode == "tenhou":
        dan = min(10, max(1, s.pt_dan))
        table = (60, 30, 0, -(10 * dan + 10)) if length == "tonpuu" else (90, 45, 0, -(15 * dan + 15))
        return float(table[rank - 1])
    return round((scores[seat] - 30000) / 1000 + UMA[rank - 1] + (20 if rank == 1 else 0), 1)


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
        point=0.0,  # filled in by list_games under the current pt rule
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
    # pt depends on settings (rule can change), so it is computed here rather than cached
    from dataclasses import replace

    metas = [replace(m, point=game_point(m.scores, m.rank, m.human, m.length, settings)) for m in metas]
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
    out["review"] = review_breakdown(settings, [g.id for g in games])
    return out


def _num(v):
    if isinstance(v, float):
        return None if v != v else round(v, 4)  # NaN (no samples) -> null
    return v



# -- discard drills (何切练习) ------------------------------------------------------

DRILLS_FILE = DATA / "drills.json"
# an answer counts as "good" (not the top choice, but fine) when Mortal gave it at least this
DRILL_GOOD_PROB = 0.2
# answered right this many times in a row = mastered (drops out of the 错题 list)
DRILL_MASTERED = 2
_WIND = "东南西北"
_drill_cache: dict[Path, tuple[tuple[float, float], list[dict]]] = {}
_drills_lock = threading.Lock()


def _event_context(events: list[dict], seat: int) -> list[tuple[str, int, bool, bool]]:
    """Per event: kyoku label, ``seat``'s draw count this kyoku, opponent riichi standing, ``seat`` is dealer."""
    ctx: list[tuple[str, int, bool, bool]] = []
    label, turn, riichi, oya = "", 0, False, False
    for ev in events:
        t = ev["type"]
        if t == "start_kyoku":
            label = f"{_WIND[['E', 'S', 'W', 'N'].index(ev['bakaze'])]}{ev['kyoku']}局 {ev['honba']}本场"
            turn, riichi, oya = 0, False, ev.get("oya") == seat
        elif t == "tsumo" and ev["actor"] == seat:
            turn += 1
        elif t == "reach_accepted" and ev["actor"] != seat:
            riichi = True
        ctx.append((label, turn, riichi, oya))
    return ctx


def _game_drills(path: Path, meta: GameMeta) -> list[dict]:
    """Discard decisions of one reviewed game where the human differed from Mortal."""
    rf = review_file(path)
    mtime = (path.stat().st_mtime, rf.stat().st_mtime)
    cached = _drill_cache.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    review = read_review(path) or {}
    events = read_events(path)
    ctx = _event_context(events, meta.human)
    items = []
    for d in review.get("decisions", []):
        if not d.get("discard") or d.get("match") or d["index"] >= len(ctx):
            continue
        label, turn, riichi, _ = ctx[d["index"]]
        q = d.get("q", {})
        items.append(
            {
                "id": f"{meta.id}:{d['index']}",
                "game_id": meta.id,
                "index": d["index"],
                "started_at": meta.started_at,
                "kyoku": label,
                "turn": max(turn, 1),
                "riichi": riichi,  # an opponent is in riichi
                "best": d["best"],
                "best_prob": d["probs"].get(d["best"], 0.0),
                "actual": d["actual"],
                "actual_prob": d["actual_prob"],
                "loss": round(q.get(d["best"], 0.0) - q.get(d["actual"], 0.0), 4),
            }
        )
    _drill_cache[path] = (mtime, items)
    return items


def _drill_results() -> dict[str, dict]:
    try:
        return json.loads(DRILLS_FILE.read_text(encoding="utf-8")).get("results", {})
    except (OSError, ValueError):
        return {}


def list_drills(settings: Settings) -> dict:
    """Drill questions from all reviewed games you played yourself, with your practice record."""
    results = _drill_results()
    items: list[dict] = []
    unreviewed: list[str] = []
    for g in list_games(settings):
        if not g.finished or g.autoplay == "full":
            continue
        if g.review is None:
            unreviewed.append(g.id)
            continue
        for it in _game_drills(log_file(settings, g.id), g):
            items.append({**it, "result": results.get(it["id"])})
    return {"items": items, "unreviewed": unreviewed, "good_prob": DRILL_GOOD_PROB, "mastered": DRILL_MASTERED}


def grade_drill(settings: Settings, drill_id: str, choice: str) -> dict:
    """Grade an answer against the review and record it. Raises KeyError for an unknown drill."""
    game_id, _, index = drill_id.partition(":")
    path = log_file(settings, game_id)
    review = read_review(path) or {}
    d = next((d for d in review.get("decisions", []) if str(d["index"]) == index and d.get("discard")), None)
    if d is None:
        raise KeyError(drill_id)
    prob = d["probs"].get(choice, 0.0)
    grade = "best" if choice == d["best"] else "good" if prob >= DRILL_GOOD_PROB else "miss"
    ok = grade != "miss"
    with _drills_lock:
        results = _drill_results()
        r = results.get(drill_id) or {"attempts": 0, "correct": 0, "streak": 0}
        r["attempts"] += 1
        r["correct"] += ok
        r["streak"] = r["streak"] + 1 if ok else 0
        r["last"] = grade
        r["at"] = datetime.now().isoformat(timespec="seconds")
        results[drill_id] = r
        DATA.mkdir(parents=True, exist_ok=True)
        DRILLS_FILE.write_text(json.dumps({"results": results}, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"grade": grade, "prob": prob, "result": r}


def reset_drills() -> None:
    with _drills_lock:
        DRILLS_FILE.unlink(missing_ok=True)


# -- review breakdown (恶手分类统计) ----------------------------------------------

_CALLS = {"chi_low", "chi_mid", "chi_high", "pon", "kan_select"}
# (dimension, label of the dimension, classifier(decision, turn, riichi, oya) -> bucket)
_BREAKDOWN = [
    (
        "kind",
        "决策类型",
        lambda d, turn, riichi, oya: (
            ("立直判断" if "reach" in d["probs"] else "打牌")
            if d.get("discard")
            else "鸣牌判断" if _CALLS & d["probs"].keys() else "和牌 / 其他"
        ),
    ),
    ("phase", "巡目", lambda d, turn, riichi, oya: "序盘 (1–6 巡)" if turn <= 6 else "中盘 (7–12 巡)" if turn <= 12 else "终盘 (13 巡~)"),
    ("riichi", "对手立直", lambda d, turn, riichi, oya: "对手立直中" if riichi else "无人立直"),
    ("oya", "亲 / 子", lambda d, turn, riichi, oya: "亲家" if oya else "子家"),
]
_BUCKET_ORDER = ["打牌", "立直判断", "鸣牌判断", "和牌 / 其他", "序盘 (1–6 巡)", "中盘 (7–12 巡)", "终盘 (13 巡~)",
                 "无人立直", "对手立直中", "子家", "亲家"]


def review_breakdown(settings: Settings, game_ids: list[str]) -> dict | None:
    """Agreement with the AI per situation, over the reviewed games among ``game_ids``.

    Per bucket: decisions, matches, bad moves (AI gave the actual action < 5 %),
    and the summed q-gap between the AI's choice and yours.
    """
    acc: dict[str, dict[str, list[float]]] = {key: {} for key, _, _ in _BREAKDOWN}
    games = 0
    for gid in game_ids:
        path = log_file(settings, gid)
        review = read_review(path)
        if not review:
            continue
        games += 1
        ctx = _event_context(read_events(path), int(review.get("human", 0)))
        for d in review["decisions"]:
            if d["index"] >= len(ctx):
                continue
            _, turn, riichi, oya = ctx[d["index"]]
            q = d.get("q", {})
            loss = q.get(d["best"], 0.0) - q.get(d["actual"], 0.0)
            for key, _, f in _BREAKDOWN:
                b = acc[key].setdefault(f(d, turn, riichi, oya), [0, 0, 0, 0.0])
                b[0] += 1
                b[1] += bool(d["match"])
                b[2] += d["actual_prob"] < 0.05
                b[3] += loss
    if not games:
        return None
    return {
        "games": games,
        "groups": [
            {
                "key": key,
                "label": label,
                "rows": [
                    {"bucket": name, "decisions": n, "matches": m, "bad": bad, "avg_loss": round(loss / n, 4)}
                    for name, (n, m, bad, loss) in sorted(acc[key].items(), key=lambda kv: _BUCKET_ORDER.index(kv[0]))
                ],
            }
            for key, label, _ in _BREAKDOWN
        ],
    }
