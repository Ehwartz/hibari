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

The engine (`backend/engine/`) is the authoritative state machine and the
only producer of events. Its output is a stream of **mjai events**, which is
also the log format.

| File | Role |
|---|---|
| `tiles.py` | mjai tile strings, 34-kinds, dora lookup, 136-id conversion for `mahjong` |
| `rules.py` | `Rules`: length, start / target points, uma, tobi, agari-yame, extension, sanchahou |
| `wall.py` | Seeded shuffle; dead wall (5 dora, 5 ura, 4 rinshan) |
| `state.py` | `KyokuState.apply(event)`: full-information state of one kyoku (hands, melds, rivers, riichi / ippatsu / double riichi, kan owners, pao, tiles left, claimable tile) |
| `scoring.py` | `evaluate_hora` (yaku / han / fu / deltas incl. honba, deposits, pao), tenpai payments, nagashi mangan |
| `game.py` | `Game.play()` generator: the turn loop, call resolution, abortive draws, game end |
| `driver.py` | `run_game(game, agents)` synchronous driver (self-play, tests) |
| `replay.py` | Read / write `.json.gz` logs; replay through `KyokuState` and re-score |

### Generator protocol

```python
gen = Game(rules, seed).play()
prompt = next(gen)                    # Prompt(event, need={seat: ActionCandidate})
while True:
    actions = {seat: ... for seat in prompt.need}
    prompt = gen.send(actions)        # StopIteration at end_game
```

Every event is yielded exactly once, so a driver forwards the whole stream to
all agents (masked per seat with `mask_event`). The same engine can be driven
synchronously (self-play) or from an async WebSocket handler (M2) without
changes.

### Legality: libriichi as referee

The engine keeps four `libriichi.state.PlayerState` referees, each fed that
seat's masked view. Who may act after an event (`need`) comes from their
`ActionCandidate`s, and every reply goes through `validate_reaction`;
illegal replies raise `IllegalAction`. This gives Tenhou-exact legality
(furiten, kuikae, riichi wait-preserving kans, kyuushu, …) for free, and the
human player in M2 gets the same candidates for the action bar.

Hand-level rules are therefore fixed to Tenhou's (3 red fives, kuitan,
atozuke, no double yakuman, kazoe yakuman). `Rules` only covers game-level
options.

### Event ordering (mirrors libriichi's arena)

- ankan → `dora` → rinshan `tsumo`
- daiminkan / kakan → rinshan `tsumo` → [actor decides] → `dora` → `dahai`.
  The new dora is flipped only right before the kan player's next discard
  (or ankan), so it does **not** count for a rinshan kaihou or a chankan.
  A kakan made while that dora is still pending flips it before the next
  rinshan draw. The `dora` event gives no one a decision.
- `reach` → `dahai` (same actor) → [ron check] → `reach_accepted` → calls
- Call priority: ron > pon / daiminkan > chi. Triple ron aborts the hand.
- Multi-ron: `hora` events in seat order from the discarder; honba and
  deposits go to the first only.
- Abortive draws: kyuushu kyuuhai, suufon renda, suucha riichi, suukaikan,
  sanchahou → `ryukyoku` with `reason` and zero deltas; dealer stays.

### Log extensions

Events are standard mjai plus a few extra fields (libriichi ignores unknown
fields; `PlayerState` and `Stat` both verified):

- `start_game.seed: [seed, 0]` — wall reproducible from the seed
- `hora.pai / han / fu / yaku / scores`
- `ryukyoku.reason / tenpai`
- `end_game.scores` (after leftover deposits go to the top player)

### Game end (Tenhou-style)

At the end of each kyoku in all-last or later: tobi ends the game; the dealer
continues on a win / tenpai unless they are top with ≥ target (agari-yame);
otherwise the game ends once someone has ≥ target, or at the hard limit
(West 4 for hanchan, South 4 for tonpuu, with extension). Abortive draws
always continue. Rank ties break by seat order.

### Verification

- `tests/fixtures/arena/`: 13 libriichi arena logs. Replaying them through
  `KyokuState` + `scoring` reproduces every `hora` / `ryukyoku` delta
  (504 wins and 80 draws in the full reference set, incl. double ron).
- Hand-made cases for paths the arena rarely hits: pao, nagashi mangan,
  tenpai payments, double riichi + ippatsu + ura.
- Fuzzing: `SimpleAgent` (shanten-greedy, random calls / kans) plays full
  hanchan in ~0.6 s each; Mortal ×4 ≈ 27 s per hanchan on CPU.

### Edge rules (verified 2026-10-27)

Checked against libriichi's arena source (`libriichi/src/arena/board.rs`)
and Tenhou's rules; covered by tests:

- **Kan dora timing**: as above (`test_kan_dora_timing`).
- **Pao** (daisangen / daisuushii): the whole hand value counts, composite
  yakuman included. On tsumo the liable player pays all of it plus the
  honba. On ron the liable player and the discarder split it half and half,
  and the liable player pays the honba.
- **Nagashi mangan**: broken by your own non-yaochu discard or by another
  player calling one of your discards; your own calls and ankan don't
  matter. Paid like a mangan tsumo with no honba, replaces the tenpai
  payments; deposits stay; the dealer stays only if tenpai.
- **Tenpai at an exhaustive draw**: waiting only on a tile you already hold
  all 4 of is noten (same as libriichi's `shanten()`).

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

- `MortalAgent` (`backend/agents/mortal_agent.py`): wraps a
  `libriichi.mjai.Bot`. In the server, inference will run in a thread pool so
  the event loop is not blocked.
- `SimpleAgent` (`backend/agents/simple_agent.py`): fast rule-based agent
  for engine fuzzing, no neural net.
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
| M1 | Engine: Mortal ×4 self-play finishes hanchan; `PlayerState` referee; 1000+ hanchan without errors | ✅ done 2026-10-27 |
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
- 2026-10-27 — M1: engine is a generator (`Game.play()`), so sync self-play
  and the async server share it. Legality is delegated to libriichi
  `PlayerState` referees (Tenhou hand rules, fixed); scoring uses `mahjong`
  2.x and matches libriichi's arena deltas exactly (multi-ron: honba and
  deposits to the first winner only). Logs carry extra fields (han / fu /
  yaku, ryukyoku reason) — libriichi tolerates them.
- 2026-10-27 — Edge rules aligned with the arena / Tenhou: minkan dora no
  longer counts for rinshan kaihou; pao uses the whole hand value, and on a
  ron the liable player pays the honba.

## 11. Dev quickstart

`mjbot_mortal/mortal.pth` (131 MB) is not in git — copy it in manually.

```
python -m pip install --user uv     # once (or install uv standalone)
python -m uv sync                   # creates .venv with Python 3.12
python -m uv run pytest             # M0 tests
python -m uv run python -m scripts.m0_smoke --seeds 1   # arena self-play → data/reference_logs/
python -m uv run python -m scripts.selfplay --agent mortal --games 1   # our engine, Mortal x4
python -m uv run python -m scripts.selfplay --agent simple --games 500 # fast fuzzing
```
