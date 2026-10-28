# Hibari 雲雀 — Architecture & Plan

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

**Gap found 2026-10-27:** `validate_reaction` only checks that a discarded
tile is in the hand. It accepts any discard after riichi, a riichi
declaration discard that breaks tenpai, and kuikae. Mortal never tries
these, so the arena never needed the checks. `backend/engine/legality.py`
(`discard_error`) enforces them in both the engine and `legal_actions`.
Ankan / kakan options come from libriichi's `ankan_candidates()` /
`kakan_candidates()`, which respect riichi.

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
- `hora.pai / tehai / han / fu / yaku / scores` (`tehai`: the winner's revealed
  concealed tiles, without the winning tile)
- `ryukyoku.reason / tenpai / tehais` (`tehais`: revealed hands of tenpai
  players, `null` for the others)
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
- Server (`backend/server/`, M2):
  - `POST /api/games` `{length, seed?, player_name?, hints?}` → `{game_id, seed}`
  - `GET /api/games/{id}` → `{finished, scores}`
  - `WS /api/games/{id}/ws`, play (message format in `session.py`).
  - Planned for later milestones: `GET /api/games` (list), `GET /api/games/{id}/log`,
    `GET /api/games/{id}/review`, `GET /api/stats`.
- `GameSession`: drives `Game.play()` in an asyncio task. Bots, plus a
  shadow Mortal in the human's seat for hints, run in `asyncio.to_thread`.
  When the human may act, the message carries `actions` (from
  `legal_actions`) and `hint`; the reply must be one of those actions,
  anything else gets a non-fatal `error`. Bots get a simulated thinking time
  (`think`, default uniform 1–3 s) before their
  decisions take effect. Passing on a call is instant, so a pause never
  reveals a possible call; a forced tsumogiri after riichi takes 0.3–1 s. Every message is kept in
  `history`; a (re)connecting client gets all of it again with
  `replay: true`, except the still-pending decision. The full log is saved
  to `data/games/{id}.json.gz` at the end. Sessions live in memory only, so
  a server restart loses running games.
- Client pacing: the browser queues messages and plays them back with
  per-event delays (discard animation, opponent draws, calls). It stops at
  decisions and at round results until the player acts, and skips delays
  for `replay` messages. After an accepted riichi, a forced tsumogiri is
  played automatically. Right click passes on a call, or tsumogiris on your
  own turn (which also skips riichi). It does nothing when a win is offered.
- Auto settings (left panel, persisted in localStorage, like Mahjong Soul):
  自动理牌 (on by default; when off, kept tiles go to the right end and the
  hand can be rearranged by drag & drop; the drawn tile joins after the next
  discard; the order lives in the client's table state), 自动和牌,
  不吃碰杠 (never skips ron), 自动摸切 (skips riichi / ankan; not when a win
  is offered). A single legal discard, e.g. after riichi, is always played
  automatically. The client keeps hands in arrangement order; sorting is a
  display choice (`arrange`).
- Calls, riichi and wins show a big callout (吃 碰 杠 立直 荣 自摸) on the
  actor's side, with longer pauses (calls 1.1 s, riichi 1 s, win 1.4 s
  before the result), so there is time to react.
- The drawn-tile slot always takes space, so a hand doesn't shift on draw
  or discard; only calls change its layout.
- Opponents' hands are treated as unordered: a hand discard animates from a
  random slot, so the position carries no information. A sorted layout
  would leak the tile, which is the classic 手出し位置 read. Review shows
  hands sorted.

### Platforms

Everything except launching and packaging is portable: the backend, the
engine, the UI, and libriichi, which ships prebuilt for py3.10–3.12 on
win-x64, linux-x86_64 and macOS x86_64 / arm64. torch 2.8 has no Intel-Mac
wheels, so the supported targets are Windows x64, Linux x86_64 and Apple
Silicon macOS. Mortal's prebuilt Linux libriichi needs glibc 2.39+
(Ubuntu 24.04, Debian 13, Fedora 40); older distros would need libriichi
rebuilt from Mortal's Rust sources. CI found this on ubuntu-22.04. `uv.lock` already resolves torch for all three (the CPU
index on Windows / Linux, PyPI on macOS).

- `scripts/launch.py` picks a Chromium browser per OS:
  - Windows: App Paths registry, then the install folders.
  - macOS: `/Applications` or `~/Applications` (Chrome, Edge, Chromium).
  - Linux: commands on `PATH` (google-chrome, microsoft-edge, chromium).

  Without one, it opens the default browser and runs until stopped.
  Messages go to `MessageBoxW`, `osascript` or `zenity`, and also to
  stderr. On non-Windows the version comes from `--version`. The macOS
  browser outlives its last window, so Hibari stops on Cmd+Q.
- Entry points are `start.cmd` / `dev.cmd` (Windows), `start.sh` /
  `dev.sh` (Linux and macOS), and `start.command` (macOS Finder,
  delegates to `start.sh`). `.gitattributes` keeps the shell scripts LF and
  the batch files CRLF. The shell scripts are committed executable.
- `tests/test_launch.py` simulates the macOS and Linux browser lookup.
  CI runs the whole suite and a packaged smoke test on real Linux and
  macOS runners.

### Preset avatars

Image files in the bot folder's `*avatars` subfolders (for example
`mjbot_mortal/saki_avatars/`) are preset avatars, listed by
`storage.avatar_presets`. Settings carry their URLs as `avatar_presets`,
and `GET /api/avatar-presets/<dir>/<file>` serves only listed files.

- AI-A/B/C without an uploaded avatar show presets 1–3 (`avatarUrl` in
  `appearance.ts`).
- Every avatar picker shows the presets as thumbnails. Picking one fetches
  it and uploads it like a chosen file (square crop).
- The presets are third-party artwork. Like the weights, they are
  git-ignored and travel with them: `build_release` copies them when it
  includes the weights, and `add_weights` adds them too.

### Logo and icons

The logo is a teal skylark (雲雀) gliding over a light-blue cloud on a
mahjong tile; the one-bamboo tile traditionally shows a bird.
`frontend/public/logo/` holds the full design (`hibari.svg`) and a
simplified one for 32 px and below (`hibari-small.svg`: no cloud, eye or
wing line, bigger bird), each also on a square canvas (`*-square.svg`).
The favicon (also the Chrome app-window icon) is `hibari-small-square.svg`,
and the sidebar shows `hibari-small.svg` next to 雲雀 Hibari.

`scripts/make_icons.py` renders PNGs from the SVGs in headless Chrome. Each
size is drawn from the vector source, with the simplified design up to
32 px. It writes `scripts/release/icons/`:

- `hibari.ico` (PNG entries 16–256), compiled into `Hibari.exe` with
  `csc /win32icon`;
- `hibari.icns` (PNG entries 16–1024), used as the `CFBundleIconFile` of
  `Hibari.app`;
- `hibari-256.png`, shipped as `hibari.png` in the Linux package.

These outputs are committed, so CI needs no rendering step.

### Same-tile highlight and 进张分析

- **同牌高亮**: `Hand` reports the tile under the mouse. Every `Tile`
  carries `data-tile`, and the hand listens with one delegated `mouseover`.
  `Table` then marks the same kind (red fives included) in all rivers and
  melds with a blue tint (`Tile mark`), distinct from the gold hint
  highlight. The mark also covers the tile's edge, which is drawn as a box
  shadow below the face. The setting (`localStorage` `samehl`, on by
  default) is shared by the game page and the replay viewer, which both
  have the toggle and 进张分析 at the right of the header, in the same order.
  Replay analyses `masked[index]`, your own view at that step. The replay header
  has two fixed rows. The first holds the step controls and the kyoku
  select, with the review info and display toggles at the right; it wraps
  only below about 1300 px. The second is a full-width progress slider
  followed by the step count and the description of the step.
  `ScaledStage` gets the header's measured height (ResizeObserver) and
  refits when that height changes, not only on window resize.
- **进张分析**: `POST /api/ukeire {hand, visible}` (`backend/analysis/ukeire.py`)
  works with the `mahjong` library's shanten (chiitoitsu and kokushi from
  13 tiles). With 3n+2 tiles it returns one option per discard kind; with
  3n+1 tiles, the hand itself. Each option lists the draws that lower the
  shanten, with 4 minus the visible copies left. `visible` is counted on the
  client (`visibleCounts`): rivers without the called tiles, every meld (a
  kan counts all four) and the dora indicators. `UkeirePanel` is a
  centered, scrollable window sorted by shanten and then total acceptance.
  It recomputes whenever your hand or the visible tiles change, and closes
  with Esc or a click outside.
- Quitting a game arms a 3 s fallback redirect home in case the server's
  answer is lost. It is cleared when the answer arrives or the page
  unmounts, and it only redirects while the game page is still shown.
  Before this fix, opening a replay right after quitting could be yanked
  back home.

### Sound

`frontend/src/lib/sound.ts` handles two kinds of sound:

- **Tile clacks** (discard, plus a soft one per dealt group) are synthesized
  with Web Audio. "BD2", chosen by ear from a comparison of variants, is a
  crisp band-passed click (about 3.8 kHz), a softer second click 20 ms later
  as the tile settles, and a short resin "ding" (2.65 and 3.95 kHz sines,
  30–40 ms). They use no files and need no license.
- **Call, riichi and win voices** are WAV files in
  `frontend/src/assets/voice/<player>/{chi,pon,kan,riichi,ron,tsumo}.wav`,
  where `<player>` is human or ai1–3, plus `credits.json`. `sound.ts` loads
  them with `import.meta.glob(..., { query: '?inline' })`: each clip
  becomes a small lazy JS chunk holding a `data:audio/wav` URL, which is
  decoded locally. The browser never requests a `.wav`, because download
  managers such as IDM intercept audio requests: the page gets an empty
  204 and the user gets a download prompt per clip (found on the
  development machine). Each player has a different VOICEVOX character, all
  from the 東北ずん子 project so that one set of terms applies. That
  license asks for the "VOICEVOX:<character>" credit, which is shown on
  the settings page and also in the README and `使用说明.txt`. The clips are
  not covered by the AGPL. `scripts/make_voices.py` regenerates them from a
  local VOICEVOX engine and normalizes their peaks; the generated levels
  differed up to 6×.

Play's event loop plays them for live events, not for replayed history,
and decodes the clips at `start_game`. ReplayViewer plays them when
stepping forward by one event, but not on jumps or when going back. Volumes come from settings
`sound_tiles` and `sound_voice` (0–1, where 0 turns them off). The audio
context is resumed on the first pointer or key event because of the
browsers' autoplay rules.

### Caching of the built UI

`FrontendFiles` (in `app.py`) serves `index.html` with
`Cache-Control: no-cache` and the hashed `assets/*` with `immutable`.
Without this, Chrome's heuristic cache kept the old `index.html`, and with
it the old bundle, for up to about an hour after an update. Starlette hands
`get_response` an OS path, so on Windows the separator is normalized.

### Kyoku intro and leaving a game

- A live (not replayed) `start_kyoku` shows a "东1局 / 0 本场 · 供托 · 亲家"
  banner for 1.3 s. It is followed by a deal animation: Table's `deal`
  prop passes per-tile `animation-delay`s to `Hand`. Dealing is 4 tiles
  per player three times, dealer first, then 1 each, which makes 16 steps
  at 85 ms. Playback pauses for the whole intro, about 2.7 s.
- The game loop starts when the first client attaches
  (`GameSession.start` from `attach`), not when the game is created.
  Otherwise the first kyoku could already be history, replayed without the
  intro, by the time the page connects.
- 「退出对局」 asks for confirmation. Choosing 保存 or 不保存 sends
  `{"type": "quit", "save": bool}`. The session cancels its task and, with
  `save`, writes the log so far (no `end_game`, so it is unfinished: it can
  be replayed but is not in stats or drills). It then answers
  `{"type": "quit", "saved": path | null}` and is dropped. The client goes
  home and does not reconnect. A finished game's button just goes home.

### Server → client contract (M2)

The browser rebuilds the table itself from **masked mjai events**
(`frontend/src/lib/table.ts`: `applyEvent`), so the server only streams
events. When the human may act, the event comes with a list of **concrete
legal actions** (`backend/engine/actions.py: legal_actions`): every discard
tile, each chi / pon / kan variant (red five or not), reach, hora, kyuushu,
pass. Each candidate is generated from the hand and then checked with the
referee's `validate_reaction`. The client just sends one of them back.
Optional `hint`: Mortal's top-3 for the same decision
(`backend.mortal.top_actions`, normalised `{type, label, tiles, prob}`).

## 6b. Frontend

React 19 + TypeScript + Vite 8 + Tailwind 4 in `frontend/`.

| Path | Role |
|---|---|
| `src/lib/tiles.ts` | Tile parsing, sorting, SVG paths, Chinese names |
| `src/lib/mjai.ts` | Event / action / hint types, `maskEvent` |
| `src/lib/table.ts` | `applyEvent` reducer → `TableState` (hands, drawn tile, melds, rivers, riichi, results) |
| `src/lib/labels.ts` | Yaku / draw names (zh), hand limit names |
| `src/components/Table.tsx` | 1280×880 stage, scaled to fit. Each seat's river / hand / melds is a group rotated around the table centre; centre panel, dora panel |
| `src/components/TableParts.tsx` | River, melds (Tenhou layout: called tile sideways by source, kakan stacked, ankan ends face-down), hands |
| `src/components/Overlays.tsx` | Action bar (with option picker), Mortal hint panel, round result, final standings |
| `src/pages/Preview.tsx` | Backend-free preview: steps through `src/mock/game.json` |

- Tsumogiri vs tedashi: during play the difference is shown **on the
  discard action**, not on the river tile. For ~0.5 s the actor's hand is
  drawn as it was before the discard; the leaving tile lifts out from its
  slot (no text label). Tsumogiri uses the separate drawn tile;
  tedashi uses the tile's position in the hand, or a stable pseudo-random
  slot for hidden hands, since the real slot is not in the event stream.
  In review the 摸切明暗 toggle darkens tsumogiri tiles in the rivers. Called
  tiles stay in the river, translucent, and are shaded the same way.
- Tiles: [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles)
  SVG faces (CC0) in `public/tiles/`, drawn over a CSS tile body. Haku gets a
  drawn frame (blank in this set).
- Mock data: `uv run python -m scripts.export_mock --seed 12 --length hanchan`
  exports a Mortal ×4 game with seat-0 legal actions and hints. It also
  asserts that every Mortal decision is in `legal_actions`, which makes it a
  regression check for the action enumerator.
- Browser support: Tailwind 4 needs a modern engine (cascade layers etc.).
  Chrome 155 works; this machine's Edge 98 does **not**. That matters for
  packaging (M6): pywebview uses WebView2, which isn't installed here, so
  either bundle / require a current WebView2 or open the app in Chrome
  `--app` mode.

## 7. Storage

`backend/storage/__init__.py`. No database for now: the **log folder is the
source of truth**.

- Settings: `data/settings.json` (`player_name`, `log_dir`,
  `default_length`, `think_min` / `think_max`). `POST /api/games` falls
  back to these for anything not given.
- Logs: one `{game_id}.json.gz` per finished game in `log_dir`. Game ids look
  like `20261027-221824-ab12cd`. `start_game` carries `started_at` and
  `length`; `end_game` carries the final `scores`.
- `list_games` scans the folder and reads metadata (date, length, names,
  scores, the human's rank / pt, kyoku count). It is cached by
  (path, mtime), so files copied in show up and deleted ones disappear.
- Assets: avatars (you + Mortal-A/B/C), custom table cloth and background in
  `data/assets/` (`avatars/{player,ai1,ai2,ai3}.png`, `felt.*`,
  `background.*`). `PUT /api/assets/{name}` takes a raw image body (png /
  jpeg / webp, ≤ 8 MB). The browser has already center-cropped avatars to
  1:1 at 256 px and scaled other images to ≤ 1920 px. Versions are kept in
  `settings.assets` for cache busting. `settings.felt` / `background` are a
  preset key or `custom`. Presets and CSS variables are in
  `frontend/src/lib/appearance.ts`.
- API: `GET/PUT /api/settings`, `GET /api/logs`, `GET /api/logs/{id}`
  (events), `DELETE /api/logs/{id}`, `POST /api/stats {game_ids?}`,
  `GET /api/drills`, `POST /api/drills/answer`, `DELETE /api/drills/results`.
- Drill results: `data/drills.json` (see §8, Discard drills).
- Tests point `storage.load_settings` / `SETTINGS_FILE` at a temp dir and
  never write to `data/`.

## 8. Analysis

### Mortal review (M4)

`backend/analysis/review.py`, `POST /api/logs/{id}/review` (≈1–3 s per game)
and `GET /api/logs/{id}/review`.

- The log is replayed, masked for the human's seat, into a **greedy**
  Mortal bot. Wherever the bot emits a reaction with `q_values` is exactly
  a point where the human had a decision. Its probabilities are
  softmax(Q / 0.3) over the legal actions, the same scale as the hint panel
  and bot temperature.
- The actual action is the human's next action event after the decision
  (skipping `dora`, `reach_accepted` and other players' `hora`), or `none`
  if they passed. Labels follow Mortal's action space: tiles incl.
  `5mr/5pr/5sr`, `reach`, `chi_low/mid/high`, `pon`, `kan_select`, `hora`,
  `ryukyoku`, `none`.
- Saved as `{id}.review.json` next to the log, and deleted with it.
  Summary: decisions, matches, agreement rate, bad moves (actual < 5 %).
  It shows on the logs table, which offers 复盘 for unreviewed games.
- Self-check test: when greedy Mortal itself plays the reviewed seat,
  agreement must be 100 %. This catches any misalignment of decision points
  or labels.
- Replay UI: Mortal's probability above each tile (best in gold), a red
  ring on the tile actually discarded, a top-3 panel with your choice, the
  agreement rate, a 下一处不一致 button. Left click = next step, wheel =
  step forward / back.

### Deal-in risk (铳率)

`frontend/src/lib/danger.ts`, client-side. It uses public information only
(rivers incl. called tiles, melds, riichi, dora indicators) plus your own
hand, so it is the same during play and in review.

- risk = P(tenpai) × P(deal in | tenpai, tile category).
- P(tenpai): 1 after riichi; otherwise a function of the turn and the number
  of open melds.
- Genbutsu = 0: the opponent's own discards, plus anything discarded after
  their riichi (needs the global discard order: `RiverTile.seq`,
  `SeatView.riichiSeq`).
- Honors by unseen copies. Number tiles by how many ryanmen sides are still
  possible; a side is closed by suji (genbutsu on the other end) or kabe
  (all 4 of a needed neighbour visible). Roughly the usual stats vs riichi:
  musuji 4–6 ≈ 12.5 %, suji 1/9 ≈ 1.8 %.
- UI: three bars under each own tile (上家 #3d93dc, 对家 #c98420, 下家
  #d9579a on a #10201a track; full bar = 15 %). This categorical set
  passed the dataviz palette validator. Each opponent's avatar card has a
  small button (color + riichi / est. tenpai %) that opens a 34-tile risk
  popover below it. On by default in replay; a 铳率 toggle in play (off by
  default). The Mortal hint panel sits right-lower, above the action bar.
- Replay input: left click = next step, wheel = step, right click =
  previous step (the browser menu is suppressed).
- Known limits: a heuristic. No dora / yaku weighting, no per-turn
  calibration, no read of the opponent's hand shape. A better model could
  be Monte-Carlo over unseen tiles, or a learned danger head.

### AI 代打 (Mortal plays your seat)

- Live: the 「AI 代打」 toggle (`{"type":"autoplay","on":…}` over the
  WebSocket) makes the session play the human's seat. It reuses the hint
  shadow's reaction: at temperature 0 the shadow's own action, otherwise a
  label sampled from softmax(Q / `settings.auto_temp`) mapped to a concrete
  legal action (`backend/agents/autopilot.py`). It uses the bots' think
  time, takes over an open decision immediately, and round results close
  by themselves. `end_game.auto_decisions` records how many decisions it
  made → the log is tagged `partial`.
- Batch: `POST /api/batch {length, count}` (`backend/server/batch.py`)
  plays N games back to back with Mortal in all four seats (yours at
  `auto_temp`) and no think time. `start_game.autoplay = "full"`.
  `GET /api/batch` gives progress, `POST /api/batch/cancel` stops after the
  current game. UI: a card on the 对局 page.
- Fully AI-played games are excluded from stats by default (数据 has a
  「计入代打对局」 toggle; the default `/api/stats` selection skips them).

### Discard drills (何切练习, M5)

- Questions come from existing reviews, with no extra AI runs: every discard
  decision (`discard: true`) where you did not pick Mortal's top choice, in
  finished games that were not fully AI-played (`storage.list_drills`).
  Each item carries the kyoku label, your turn number, whether an opponent's
  riichi stood, the best and actual labels with probabilities, and the
  q-gap. Items are cached per game by (log mtime, review mtime). Drill id =
  `"<game_id>:<event index>"`.
- Answers: `POST /api/drills/answer {id, choice}`. The grade is computed on
  the server from the review: `best` = top choice, `good` = prob ≥ 0.2,
  otherwise `miss`. Results go to `data/drills.json`, keyed by drill id,
  with attempts / correct / streak / last. Two right answers in a row
  count as mastered and drop the item out of 错题. `DELETE
  /api/drills/results` resets them.
- UI (`pages/Drill.tsx`): 练习 in the sidebar shows totals, filters
  (全部 / 恶手 < 5% / 错题 / 未练习 / 有人立直), the question count, a
  「全部复盘」 button for unreviewed games, and the question list.
  `#/drill/run?f=&n=` replays the log (masked to your seat) up to the
  decision event and lets you click a tile, or a 立直 / 杠 / … button for
  non-tile labels. It then shows the grade, Mortal's probabilities on every
  tile, the top 3, what you played in the game, and a link to
  `#/replay/<id>?frame=<index>` (Replay now also reads `?frame` after the
  hash).
- Practice tabs (练习 page header): 何切练习 `#/drill`, 听牌练习
  `#/drill/wait`, 点数计算 `#/drill/score`.

### Generated quizzes (听牌 / 点数)

- `backend/analysis/quiz.py`, `GET /api/quiz/wait?mode=mixed|chinitsu`,
  `GET /api/quiz/score`. Both are stateless and take an optional `seed`.
  The client grades the answer, and the session tally is not stored.
- A complete hand (4 groups + a pair, at most 4 copies of a kind) is
  drawn at random.
  - Wait quiz: one tile is removed and the waits are computed with
    `Agari.is_agari`. Kinds held 4× are not counted as waits. Multi-sided
    waits are preferred (≥ 3 for chinitsu, ≥ 2 otherwise). `forms` holds
    `HandDivider` splits for the explanation.
  - Score quiz: 0–2 groups become open pon / chi. Some fives are made red,
    and a suit's red five is forced when all four fives of that suit are in
    the hand. The quiz also randomizes riichi (closed hands only),
    tsumo / ron, dealer, round wind and one dora indicator. Scoring uses the
    engine's `_OPTIONS`. No-yaku hands and yakuman are re-drawn. The answer
    has han, fu, yaku, `fu_details` and the payment
    (ron / all / ko + oya). Fu is only graded below mangan.

### Review breakdown and trends (数据 page)

- `storage.review_breakdown`, returned as `review` by `POST /api/stats`
  for the selected games that have a review, groups every reviewed
  decision four ways:
  - decision kind: 打牌 / 立直判断 / 鸣牌判断 / 和牌·其他
  - phase by your draw count: 1–6 / 7–12 / 13+
  - opponent riichi standing or not
  - dealer or not
  Per bucket: decisions, matches, bad moves and the mean q-gap.
  `_event_context` (shared with drills) provides the per-event kyoku,
  turn, riichi and dealer info.
- Trend charts (agreement and bad-move rate per game, with a 5-game moving
  average) are drawn on the client from `GameMeta.review`. They are two
  charts, not a dual axis.

### Q-gap view

- The review stores Mortal's q per legal action. The q-gap is
  q(best) − q(option), so 0 is the AI's choice. The replay has a 「Q 差」
  toggle that shows q-gaps instead of probabilities on the tiles and in
  the hint panel. Drill answers show the q-gap of your choice and of the
  game move. It is Mortal's value estimate, not points, so the UI says so.

- Partial-autoplay games stay in the pool. Their AI-made decisions are not
  marked in the log, but at `auto_temp` 0 they match the review and so
  never become questions.

## 9. Milestones & status

Planned features: see [TODO.md](TODO.md).

| # | Milestone | Status |
|---|---|---|
| M0 | Env: uv + Python 3.12 + CPU torch; load Mortal in-process; bot answers sample events; `PlayerState` works | ✅ done 2026-10-27 |
| M1 | Engine: Mortal ×4 self-play finishes hanchan; `PlayerState` referee; 1000+ hanchan without errors | ✅ done 2026-10-27 |
| M2 | Human vs 3 bots in the browser (WebSocket + React table) | ✅ done 2026-10-27 |
| M3 | Persist games, replay viewer | ✅ done 2026-10-27 (log folder + list / replay / delete) |
| M4 | Mortal review | ✅ done 2026-10-28 (review + replay annotations + deal-in risk) |
| M5 | Stats dashboard, training features | ✅ done 2026-10-28 (stats dashboard, 何切 drills, wait / score quizzes, review breakdown + trends, Q-gap view) |
| M6 | Desktop packaging | ✅ done 2026-10-28 (portable zip: `scripts/build_release.py`) |

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
- 2026-10-27 — Seats and bot randomness. Seat 0 stays the first dealer (mjai
  convention), so the human's seat is drawn at random and Mortal-A/B/C fill
  the other seats in random order. `start_game` records `human`, `players`
  (per seat: human / ai1..3) and the bots' `temperatures`; storage and the
  UI use `human` instead of assuming seat 0. Each bot has a sampling
  temperature (`settings.bot_temps`): 0 is greedy, otherwise
  softmax(Q / T) over the legal actions, via a `MortalEngine` per
  temperature that shares the loaded network
  (`backend.mortal.sampling_engine`). T = 0.3 matches the hint panel's
  probabilities. The hint shadow is always greedy. The wall was already
  random: a random seed per game and a fresh shuffle every kyoku.
- 2026-10-28 — 何切 drills are built from saved reviews instead of a
  separate puzzle set, so they reflect your own mistakes and cost no extra
  inference. "Good" (prob ≥ 0.2) counts as right, because close second
  choices are not real mistakes.
- 2026-10-28 — pt rule is a setting (`pt_mode`). "score" = (points − 30000)
  / 1000 + uma 20/10/−10/−20 + oka 20, the same for both lengths. "tenhou" =
  Tenhou 鳳凰卓 dan pt, rank only: hanchan +90/+45/0/−(15·dan+15), tonpuu
  +60/+30/0/−(10·dan+10), with `pt_dan` 1–10. The 4th-place values are from
  memory of Tenhou's table, not from an official page. pt is never stored;
  `storage.game_point` / `lib/pt.ts` compute it from the final scores, so
  switching re-rates all logs. A Mahjong Soul preset was left out because
  its per-room rank pt could not be verified.
- 2026-10-28 — Configurable AI: `settings.bot_dir` (default `mjbot_mortal`,
  read by `backend.mortal` at startup, so a restart is needed; it must follow
  the Akagi Mortal layout) and `settings.ai_name` (default "Mortal", shown as
  "<name> 推荐" / "<name> 复盘"). The default opponent names are now
  AI-A/B/C (only for fresh settings; saved names are never rewritten — an
  automatic Mortal-A/B/C → AI-A/B/C migration was removed because it undid
  users deliberately choosing those names).
- 2026-10-28 — Wide stage: `ScaledStage` gives the table the window's spare
  width (1280–1800 virtual px). The table stays centred (`cx = width / 2`)
  and side panels hug the edges. Deal-in popovers moved off the avatars into
  the margins (上家 left, 对家 top-right, 下家 right), so they never cover
  hands, melds or rivers.
- 2026-10-27 — Avatars and appearance: avatar cards are attached to the
  hand rows, so identity is obvious. Yours sits at the left end of your
  hand; the top player's at their row's left end, which is point-symmetric
  to yours. The left / right players' cards sit behind their hands, away
  from the centre and centred on the row. Cards are counter-rotated inside
  a square slot so they stay upright. The name labels behind the tiles were dropped as
  redundant. Dora / auto / hint panels are back in the corners. A
  corner-symmetric layout was tried and rejected: hard to tell who is who,
  and it displaced the dora panel. Table cloth and background are presets or uploaded images.
- 2026-10-27 — M3: app shell with a left sidebar (主页 / 对局 / 牌谱 / 数据分析 / 设置 / 用户);
  主页 has quick start, headline stats and recent games. Logs are
  files in a configurable folder, with no database; stats come from
  libriichi `Stat`. The replay viewer is shared with the UI preview
  (`components/ReplayViewer.tsx`).
- 2026-10-27 — Desktop: Chrome `--app` launcher for now (local WebView2
  is v98, too old for Tailwind 4). Electron stays the option for
  distribution (M6). The backend serves `frontend/dist`, so the app needs a
  single process.
- 2026-10-27 — M2: FastAPI + WebSocket. The client rebuilds state from
  masked mjai events and the server sends concrete legal actions, so the
  client holds no rules logic. Pacing happens on the client; reconnects
  replay the session history. Hash routing (`#/`, `#/play/{id}`,
  `#/preview`), no router library.
- 2026-10-27 — Edge rules aligned with the arena / Tenhou: minkan dora no
  longer counts for rinshan kaihou; pao uses the whole hand value, and on a
  ron the liable player pays the honba.

## 10b. Portable release (M6)

`uv run python -m scripts.build_release` builds the package for the current
OS. Nothing is downloaded: it uses the tested `.venv`.

| OS | Archive | Entry point |
|---|---|---|
| Windows | `Hibari-<v>-win64.zip` | `Hibari.exe` (`scripts/release/Hibari.cs`, compiled with the .NET Framework `csc.exe` that ships with Windows) |
| Linux | `Hibari-<v>-linux-x86_64.tar.gz` (tarfile keeps modes and symlinks) | `start.sh` |
| macOS | `Hibari-<v>-macos-arm64.zip` (`ditto`) | `Hibari/Hibari.app`; `Contents/MacOS/Hibari` is a shell script |

On macOS the app folder is `Contents/Resources/app`, and
`HIBARI_DATA=~/Library/Application Support/Hibari/data` keeps user data
out of the bundle.

- `runtime/python/` is the standalone CPython that `.venv` is based on (from
  `pyvenv.cfg` `home`; on posix that is `…/bin`, so its parent), plus
  `.venv`'s site-packages. Build-only files are left out: `*.lib` / `*.a`
  (about 2.6 GB of `.lib` in torch on Windows) and `torch/include` and
  `torch/share`. CI sets `UV_PYTHON_PREFERENCE=only-managed`, so `.venv`
  never sits on a system Python.
- The app folder keeps the repo layout, so `ROOT`-relative paths work.
  `backend/paths.py` defines `ROOT` and `DATA`: `ROOT/data`, or
  `$HIBARI_DATA`. A relative `log_dir` resolves against `DATA.parent`.
- `data/` in the package is only a seed: the AI-A/B/C avatars from the
  build machine. On macOS the launcher copies it to `HIBARI_DATA` on the
  first run.
- `mjbot_mortal/` has only the runtime files and this OS's py3.12
  libriichi. `mortal.pth` is included if present; `--no-weights` leaves it
  out, and `--allow-no-weights` builds even when it is missing (CI).
  `scripts/add_weights.py PACKAGE` adds the weights and the local AI
  avatars to any of the three archive kinds, from any OS, writing
  `release/full/`. Without weights the launcher shows a warning, and the
  quizzes still work.
- `scripts/smoke_release.py PACKAGE` unpacks into a fresh folder whose path
  has spaces and CJK characters, and checks the following with only the
  bundled interpreter:
  - `sys.path` stays inside the package, and the launcher imports and
    finds a browser;
  - the server starts and plays a tonpuu over the WebSocket (rule-based
    bots, so no weights are needed), the log is written under the data
    folder, and a quiz works;
  - with weights, an AI 代打 game and a review run too.
- CI (`.github/workflows/ci.yml`) runs a matrix of windows-latest,
  ubuntu-24.04 (glibc 2.39, for libriichi) and macos-14 (arm64). Each job runs `uv sync`, `npm ci`, the
  tests (the ones that need weights are skipped; see `tests/weights.py`),
  the package build, and the smoke test, then uploads the package as an
  artifact. A `v*` tag publishes the three packages as a GitHub release.
- macOS packages are not signed or notarized. Users clear the quarantine
  once (`xattr -dr com.apple.quarantine Hibari.app`), as `使用说明.txt`
  explains.
- Licensing: `LICENSE` (AGPL-3.0) and `使用说明.txt` ship in the package,
  together with the app's sources. The weights are not covered by the
  license and should not be redistributed publicly.

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

Frontend (Node 24 LTS, installed at `%LOCALAPPDATA%\Programs
odejs`):

```
cd frontend
npm install
npm run dev          # http://localhost:5173  (#/preview: UI preview; ?frame=N jumps to a frame)
```

**App**: double-click `start.cmd`. `scripts/launch.py` rebuilds
`frontend/dist` if the sources changed and starts the backend on a free port
(it also serves the built UI, one process). It then opens Chrome in `--app`
mode with its own profile (`data/chrome-app`): a separate window with no
address bar. Closing the window stops the backend. Logs are in
`data/launcher.log` and `data/server.log`.

**Development**: double-click `dev.cmd` (or run it from any shell). It opens two
windows, backend on :8000 and frontend on :5173 (which proxies `/api`), and
then the browser. By hand, in two terminals (Windows PowerShell 5.1 has no
`&&`):

```
python -m uv run uvicorn backend.server.app:app --port 8000
cd frontend; npm run dev
```
