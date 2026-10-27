# Mahjong AI Trainer — Architecture & Plan

A Riichi Mahjong (4-player) training app: one human plays against three
Mortal AIs, every game is recorded, and the human's decisions are reviewed
against Mortal afterwards.

This is a living document. Update the **Status** and **Decision log**
sections as milestones land.

---

## 1. Goals

- Play 4p riichi mahjong vs 3 Mortal bots. Hanchan (East+South) by default;
  tonpuusen and rule variants configurable.
- Persist every game: results, per-round outcomes, full game log (牌谱).
- Replay any game turn by turn.
- Review: compare each human decision with Mortal's Q-values (agreement
  rate, top-3 suggestions, worst mistakes).
- Stats dashboard: win / deal-in / riichi / call rates, average placement,
  average hand value, trends over time.
- Later: live hints toggle, "what to discard" drills generated from past
  mistakes, desktop packaging.

Non-goals (for now): online multiplayer, 3-player mahjong, training new
models.

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend / engine | Python 3.12, FastAPI, WebSocket | Mortal is Python + PyTorch + a Python extension (`libriichi`); in-process calls are simplest |
| Scoring (yaku/fu/han/points) | [`mahjong`](https://pypi.org/project/mahjong/) | Mature, avoids re-implementing scoring |
| Frontend | React + TypeScript + Vite, Tailwind CSS | Large ecosystem; table is custom-drawn anyway |
| Tile art | [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles) (SVG, public domain) | Free, clean |
| Storage | SQLite (via SQLModel) + game logs as `.jsonl.gz` (mjai format) | Single-user, zero config, single file; mjai logs are directly consumable by Mortal |
| Env / deps | `uv` | Pins Python 3.12 and the CPU PyTorch index |
| Packaging (late) | pywebview + PyInstaller | One folder, no external services. Consider ONNX Runtime instead of PyTorch to shrink the bundle |

Why not C++: the heavy parts (NN inference in PyTorch, game-state encoding
in Rust `libriichi`) are already native. Engine logic in Python costs
microseconds per step; the human takes seconds. For bulk self-play, batch
inference / ONNX / multiprocessing come before any rewrite.

## 3. Repository layout

```
mj_trainer/
├── docs/ARCHITECTURE.md      # this file
├── pyproject.toml            # uv project (Python 3.12, CPU torch)
├── mjbot_mortal/             # vendored Mortal bot — treat as read-only
├── backend/
│   ├── mortal/               # thin adapter around mjbot_mortal (path setup, Bot factory)
│   ├── engine/               # game engine (rules, wall, state machine, scoring)
│   ├── agents/               # Agent interface: MortalAgent, HumanAgent
│   ├── server/               # FastAPI app, WebSocket sessions
│   ├── storage/              # SQLite models, log read/write
│   └── analysis/             # Mortal review, stats
├── frontend/                 # React app (table, replay, review, stats, settings)
├── scripts/                  # dev scripts (smoke tests, self-play)
├── tests/                    # pytest
└── data/                     # runtime: trainer.db, logs/ (gitignored)
```

## 4. Mortal integration

`mjbot_mortal/` is the Akagi v3 packaging of Mortal:

- `model.py` builds the network from `mortal.pth` once (module-level cache)
  and exposes `load_model(seat) -> libriichi.mjai.Bot`. All bots share one
  engine (stateless in eval mode).
- `libriichi.mjai.Bot.react(event_json: str, can_act=True) -> str | None`
  takes **one** mjai event at a time and returns an action JSON when it is
  the bot's turn to act. The action's `meta` contains `q_values`,
  `mask_bits`, etc.
- `_libriichi_loader.load()` picks the prebuilt extension for the running
  Python minor version / OS (`libriichi/libriichi-3.12-x86_64-pc-windows-msvc.pyd`).
  The Python version must be 3.10–3.12; the project uses 3.12.
- `libriichi.state.PlayerState(seat)` tracks a seat's view of the game and
  validates events — used as a rule **referee** for our engine and as a
  source of legal actions / shanten.
- `meta_show.py` turns `q_values` + `mask_bits` into a top-K list with
  probabilities — reused by the review feature.
- Online inference (`ot_settings.json`) must stay `online: false`;
  `backend/mortal` forces it off after import.

We do **not** use `bot.py`'s stdin/stdout subprocess loop; the backend
imports `model` in-process through `backend/mortal/`:

```python
from backend import mortal
bot = mortal.load_bot(seat)            # libriichi.mjai.Bot
ps = mortal.new_player_state(seat)     # libriichi.state.PlayerState
lib = mortal.libriichi()               # the whole extension module
engine = mortal.get_engine()           # shared MortalEngine (for arena)
```

### libriichi API surface (verified in M0)

| Module | Contents | Use in this project |
|---|---|---|
| `mjai.Bot(engine, player_id)` | `.react(event_json) -> str \| None` | AI players, review |
| `state.PlayerState(player_id)` | `.update(event_json) -> ActionCandidate`, `.validate_reaction(...)`, `.tehai`, `.shanten`, `.waits`, `.at_furiten`, `.last_cans`, chi/pon/kan candidates | Engine referee, human legal actions, hints |
| `state.ActionCandidate` | `can_discard`, `can_chi_low/mid/high`, `can_pon`, `can_daiminkan`, `can_ankan`, `can_kakan`, `can_riichi`, `can_tsumo_agari`, `can_ron_agari`, `can_ryukyoku`, `can_pass`, `target_actor` | Building the human action bar |
| `stat.Stat` | `.from_dir(dir, player_name)`, `.from_log(...)`; ~100 metrics (agari / houjuu / riichi / fuuro rates, avg rank, avg points, …) | Stats dashboard — no need to write our own |
| `arena.OneVsThree` / `TwoVsTwo` | Rust self-play: `py_vs_py(challenger, champion, (seed, key), seed_count)`; each seed = 4 hanchan (seat rotation); writes `.json.gz` mjai logs to `log_dir` | Reference logs / fixtures for engine tests |
| `dataset` | `GameplayLoader`, `Grp` (training-data loaders) | Not needed |

Notes:
- Arena logs are full (unmasked) mjai, one event per line. `hora` events
  only have `deltas` and `ura_markers` — **no yaku / han / fu**. Our engine
  must compute those itself (with `mahjong`) for the UI and DB.
- `Stat.from_dir` matches by player name; give the human a unique name in
  `start_game.names`.
- Performance (CPU, no GPU): arena self-play ≈ 18 s per hanchan with batched
  inference; a single `Bot.react` decision is fast enough for interactive
  play.

License: Mortal is AGPL-3.0. Fine for personal use; if this app is ever
distributed, the whole app must be AGPL-compatible (or move Mortal back
behind a subprocess boundary, as Akagi does).

## 5. Engine design

The engine is the authoritative state machine and the only thing that
produces events. Its output is a stream of **mjai events**, which is also the
log format.

- Rules config: length (tonpuu / hanchan), starting points (25000),
  return (30000), uma, red fives (3), kuitan, atozuke, busting, agari-yame,
  West-round extension, abortive draws (kyuushu kyuuhai, suufon renda,
  suukaikan, suucha riichi), double / triple ron policy.
- Per-seat views: other players' `tehais` and `tsumo` tiles become `"?"`.
- Call priority: ron > pon / daiminkan > chi; collect all responses before
  resolving.
- Riichi is two mjai steps: `reach` (actor) → `dahai` (same actor) →
  `reach_accepted` once no ron happened on that discard.
- Edge cases to cover: furiten (permanent, temporary, riichi), chankan,
  kan dora timing (ankan immediate, minkan after discard), rinshan, haitei /
  houtei, pao (daisangen / daisuushii), nagashi mangan, tenpai payments.
- Validation: during development every event is fed into four
  `PlayerState`s; any exception is an engine bug. Mortal-vs-Mortal
  self-play over thousands of hanchan is the main regression test.
- Scoring cross-check: replay arena reference logs (`scripts/m0_smoke.py`)
  through our scoring code and compare `hora` / `ryukyoku` deltas with the
  Rust engine's.

### mjai event cheat-sheet

```
start_game{names,id} → start_kyoku{bakaze,dora_marker,kyoku,honba,kyotaku,oya,scores,tehais}
tsumo{actor,pai} / dahai{actor,pai,tsumogiri}
chi|pon{actor,target,pai,consumed} / daiminkan{actor,target,pai,consumed}
ankan{actor,consumed} / kakan{actor,pai,consumed} / dora{dora_marker}
reach{actor} / reach_accepted{actor}
hora{actor,target,deltas,ura_markers} / ryukyoku{deltas}
end_kyoku / end_game
```

## 6. Agents & server

```python
class Agent(Protocol):
    def react(self, event: dict) -> dict | None: ...   # one event in, maybe an action out
```

- `MortalAgent`: wraps a `libriichi.mjai.Bot`; inference runs in a thread
  pool so the event loop is not blocked.
- `HumanAgent`: pushes the (masked) event + legal actions to the browser over
  WebSocket and awaits the reply.
- Server: `POST /games` (create with rules), `WS /games/{id}` (play),
  `GET /games`, `GET /games/{id}/log`, `GET /games/{id}/review`, `GET /stats`.

## 7. Storage

- `game`: id, started/ended at, rules JSON, seat names, final scores,
  placements, log path.
- `kyoku`: game id, round / honba, winner, loser, han / fu / points,
  draw type, riichi / call flags per seat.
- `decision` (filled by review): game id, kyoku, turn, human action,
  Mortal top-3 with probabilities, Q-loss.
- Logs: `data/logs/{game_id}.jsonl.gz`, one mjai event per line, unmasked.
  Optional exporter to tenhou.net/6 JSON for external viewers.

## 8. Analysis

- **Review**: replay the log into a seat-0 `Bot`; at each human decision
  point read `q_values` / `mask_bits`, compare to the actual action → agreement
  rate, per-decision top-3, ranked mistakes by Q gap.
- **Stats**: `libriichi.stat.Stat` over the human's logs gives the standard
  metrics directly; the `kyoku` / `game` tables add per-game trends and
  filters.
- Later: live hints (run a shadow seat-0 Bot during play), discard drills.

## 9. Milestones & status

| # | Milestone | Status |
|---|---|---|
| M0 | Env: uv + Python 3.12 + CPU torch; load Mortal in-process; bot answers sample events; `PlayerState` works | ✅ done 2026-10-27 |
| M1 | Engine: Mortal ×4 self-play finishes hanchan; `PlayerState` referee; 1000+ hanchan without errors | — |
| M2 | Human vs 3 bots in the browser (WebSocket + React table) | — |
| M3 | Persist games, replay viewer | — |
| M4 | Mortal review | — |
| M5 | Stats dashboard, training features | — |
| M6 | Desktop packaging | — |

## 10. Decision log

- 2026-10-27 — Python backend, React frontend, SQLite, pywebview + PyInstaller
  packaging. Own engine in Python instead of forking Mortal's Rust arena.
  Mortal runs in-process (not via `bot.py` subprocess).
- 2026-10-27 — M0: uv-managed Python 3.12 venv with torch 2.8.0+cpu. Stats
  will use `libriichi.stat.Stat` instead of hand-written aggregation.
  Arena logs serve as engine test fixtures.

## 11. Dev quickstart

`mjbot_mortal/mortal.pth` (131 MB) is not in git — copy it in manually.

```
python -m pip install --user uv     # once (or install uv standalone)
python -m uv sync                   # creates .venv with Python 3.12
python -m uv run pytest             # M0 tests
python -m uv run python -m scripts.m0_smoke --seeds 1   # 4 hanchan self-play → data/reference_logs/
```
