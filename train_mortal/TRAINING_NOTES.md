# Training notes: continuing Akagi's Mortal

What was done to train new Mortal models (different play styles) starting from the `mortal.pth`
that ships with Akagi, how it was done, what broke along the way and how it was fixed, and the
measured numbers. `README.md` in this folder is the short how-to; this file is the record.

Last updated: 2026-10-29.

## 1. Goal

Train variants of the Mortal model used by Hibari that play with different priorities:

| Style | `[env] pts` (rank points for 1st/2nd/3rd/4th) | Intent |
|---|---|---|
| `avoid4` | `[3.0, 1.5, 0.0, -4.5]` | avoid last place (Tenhou dan ratio 90/45/0/-135) |
| `balance` | `[3.0, 1.0, -1.0, -3.0]` | evenly spaced |
| `top` | `[4.5, 1.5, 0.0, -3.0]` | play for first place |

The models are for practice in Hibari only. The starting weights have no clear license, so neither
they nor anything trained from them is published.

## 2. How Mortal trains (what the code actually does)

Read from the Mortal sources (`mortal/*.py`, commit `0cff2b5`), not from documentation, which
does not describe training.

- **Reward.** `reward_calculator.py`: a small GRP network predicts, after each kyoku, the
  probability of each final rank. The expected rank points (`rank_prob @ pts`) are computed per
  kyoku, and the reward of a kyoku is the change from one kyoku to the next. Changing `pts`
  therefore changes what the model is rewarded for, which is how styles are made.
- **Offline phase.** `train.py` with `online = false`: DQN + CQL on human game logs. Not used
  here: we have no large human log set, and self-play logs of one model would only teach that
  model back to itself.
- **Online phase.** This is what we use. Three processes:
  - `server.py` holds a buffer of submitted game logs and relays model parameters.
  - `client.py` (one or more) fetches the newest parameters and plays games in libriichi's Rust
    1v3 arena: the trainee (with Boltzmann exploration) against three copies of a frozen baseline.
    It then submits the logs.
  - `train.py` (`online = true`) drains the buffer, trains on the trainee seat's decisions only,
    and submits new parameters every `submit_every` steps.
- **Evaluation.** `train.py` runs `test_play` against the baseline every `test_every` steps.
  `one_vs_three.py` runs a standalone 1v3 match between any two checkpoints.

## 3. The starting checkpoint

`mjbot_mortal/mortal.pth` (124.7 MB) turned out to be a **complete Mortal training checkpoint**,
not just inference weights:

- keys: `mortal`, `current_dqn`, `aux_net`, `optimizer`, `scheduler`, `scaler`, `steps`,
  `timestamp`, `best_perf`, `config`;
- `steps` = 90,000, saved 2024-01-10. Network: ResNet, 40 blocks × 192 channels, version 4,
  10.8 M parameters;
- its own config: offline training on 2019–2023 human logs filtered to top players, batch size
  2560, `pts = [3.0, 1.5, 0.0, -4.5]` (so the current model already leans avoid-4th), and
  `best_perf` = avg rank 2.528 / avg pt -3.06 (against its own baseline).

Because it is a full checkpoint, online training can resume from it directly.

## 4. Problems found and how they were solved

Mortal's code was never modified; every fix lives in our scripts.

| Problem | Cause | Fix |
|---|---|---|
| `torch.load` fails on `mortal.pth` with "Unsupported global: numpy…scalar" | the checkpoint holds numpy scalars (e.g. `best_perf`), and current Mortal loads everything with `weights_only=True` | `prepare.py` loads it once with `weights_only=False` (Hibari already loads the same file that way), converts numpy values to plain numbers, saves `baseline.pth` / `trainee.pth`, and re-checks them in safe mode |
| (would fail on GPU with AMP) GradScaler rejects an empty state | the checkpoint's `scaler` is empty (trained without AMP) and `train.py` always restores it | `prepare.py --amp` writes a fresh enabled GradScaler state into `trainee.pth` (verified on the 5090) |
| "Need to provide pin_memory allocator" on CPU | Mortal pins host memory, which needs CUDA | `mortal_shim/sitecustomize.py` (loaded via `PYTHONPATH`): without CUDA, `pin_memory` becomes a no-op |
| client crashes after a round on CPU | `torch.cuda.synchronize()` without CUDA | same shim: GPU-only calls are no-ops without CUDA |
| `CUDA error: initialization error` in GRP training on Linux | DataLoader workers are forked from a process that already initialised CUDA, then pin memory | same shim: with CUDA on Linux, child processes start with `spawn` |
| prebuilt Linux libriichi unusable | Akagi's `.so` needs glibc 2.39; the rented box runs Ubuntu 22.04 (glibc 2.35) | build libriichi from Mortal's sources with Rust (`setup_remote.sh`, about 40 s) |
| setup crawling (Python download stuck) | AutoDL's `network_turbo` proxy speeds up GitHub but slows other downloads | `setup_remote.sh` uses mainland-China mirrors when it sees `/etc/network_turbo`: npmmirror (Python), Aliyun (PyPI, PyTorch wheels), rsproxy (rustup, crates). Setup then took about 10 minutes |

Locally, the Windows build of libriichi from `mjbot_mortal/libriichi/` works with current Mortal:
every interface the training code needs (`arena.OneVsThree`, `dataset.Grp`, `GameplayLoader`,
`consts`, `stat`, `mjai.Bot`) is present.

## 5. Scripts written

| File | Purpose |
|---|---|
| `make_config.py` | writes `config.toml`: style, scale (`pilot` for a CPU smoke test, `full` for a GPU), device, AMP, port |
| `prepare.py` | `mortal.pth` → `baseline.pth` (frozen opponents) + `trainee.pth` (training state), with the fixes above |
| `pilot.py` | end-to-end smoke test: 1v3 self-play → GRP → online training, with timings |
| `speedtest.py` | full-scale throughput test with 1..N clients; samples GPU utilisation and cgroup CPU usage |
| `overnight.py` | unattended run: GRP logs → GRP → online training until a deadline; restarts crashed processes; can power the machine off at the end |
| `setup_remote.sh` | one-time environment setup on a Linux GPU box (uv, Python 3.12, PyTorch 2.8 cu128, Rust, libriichi build, check) |
| `mortal_shim/sitecustomize.py` | runtime fixes, see section 4 |

The Mortal clone (`Mortal/`), the venv and `runs/` are git-ignored; so is `remote/` (login info).

## 6. Local pilot (Windows, CPU)

Python 3.12 venv with CPU PyTorch 2.8; Akagi's Windows libriichi copied to
`Mortal/mortal/libriichi.pyd`. `python pilot.py --grp-seconds 30 --online-seconds 480`:

- 1v3 self-play: 8 games in 93 s;
- GRP: 920 steps in 30 s;
- online: three full rounds of client plays → submits → server hands over → trainer trains →
  new params → client updates; trainee 90,000 → 90,040 steps. **Passed.**

## 7. Rented GPU box

- Provider: AutoDL-style (seetacloud), region 西北B区. RTX 5090 32 GB, 25 vCPU (Xeon Platinum
  8470Q), 90 GB RAM, ¥2.93/h. `nproc` reports the host's 208 cores, but the container has 25.
- Ubuntu 22.04, driver 595.91, CUDA ≤ 13.2; no Python preinstalled for us (a miniconda exists but
  is unused).
- Work directory: `/root/autodl-tmp` (the fast data disk, 50 GB), with `train_mortal/` and
  `mjbot_mortal/mortal.pth`. The 124.7 MB upload from Stockholm took 6.5 min; the sha256 matched.
- Login: an SSH key (`~/.ssh/id_ed25519_hibari_gpu`, host alias `hibari-gpu`) created by the
  user. The port may change after the machine restarts.
- Environment: `sh setup_remote.sh` installs torch 2.8.0+cu128 and libriichi built from source.
  Both check out on the 5090.

## 8. GPU pilot and speed test (RTX 5090)

GPU pilot (`pilot.py --device cuda:0 --amp`), after the `spawn` fix: passed. 8 games in 29 s,
GRP 4,060 steps per minute, trainee 90,000 → 90,140 in 5 min. AMP and the scaler fix work.

Speed test (`speedtest.py --games 800`, 6 min per phase):

| Phase | Throughput | GPU util | CPU cores used |
|---|---|---|---|
| 1v3, 800 games | 18,345 games/h | 11 % | 9.8 |
| GRP | 3,500 steps / 120 s (batch 512) | | |
| online, 1 client | 16,000 games/h; trainer 1.1 steps/s (7.4 batch/s when busy) | 17 % | 11.8 |
| online, 2 clients | 24,000 games/h; trainer 2.2 steps/s | 23 % | 19.5 / 25 |

Conclusions:

- **Self-play is CPU-bound.** The GPU is mostly idle, and two clients already use about 20 of the
  25 cores, so a third client adds little.
- The trainer can do about 6–7 batches/s but averages 2.2: it waits for data. Self-play speed
  sets the training speed.
- 800 games give about 400 training steps of 512 samples.
- For this workload, more CPU cores matter more than a faster GPU.

Rough budget, assuming about 1 M self-play games per style (the needed number is unknown;
Akagi's own config used 10,000 games per round): about 42 h at 24,000 games/h, about ¥125 per
style on this machine.

## 9. First real run (overnight, 2026-10-29)

Started 06:33 CST (23:33 Stockholm) with:

```sh
python overnight.py --style balance --hours 8 --grp-games 24000 --grp-minutes 30 --clients 2 --shutdown
```

Plan: 24,000 games of 1v3 self-play for GRP data (about 1.3 h) → GRP training 30 min → online
training of `balance` with 2 clients until 14:32 CST (07:32 Stockholm), then stop, save, and power
off (`shutdown` is AutoDL's wrapper; it stops the instance and billing, and keeps
`/root/autodl-tmp`).

Outputs in `/root/autodl-tmp/train_mortal/runs/balance/`:

- `overnight.log`: milestones and progress every 30 min;
- `logs/*.log`: per process;
- `grp_logs/`, `grp.pth`: GRP data and model;
- `trainee.pth`: the training state, continued in place;
- `tensorboard/`: training curves.

### Results

Timeline (CST):

| Phase | Time | Result |
|---|---|---|
| GRP logs, 24,000 games | 06:33 → 07:22 (49 min) | about 29k games/h, faster than the 1.3 h estimate |
| GRP training | 07:22 → 07:52 | 63,000 steps |
| Online training, 2 clients | 07:52 → 14:31 | trainee step 90,000 → 147,600 (+57,600, about 8,700 steps/h) |

Test results (2,000 games 1v3 against the baseline every 20,000 steps; equal strength is rank 2.5;
`pt` uses the balance points):

| Time | Avg rank | Avg pt | |
|---|---|---|---|
| 09:08 | 2.502 | +0.23 | saved as `best.pth` |
| 11:25 | 2.496 | +0.45 | saved as `best.pth` (about step 120,000) |
| 13:42 | 2.627 | −9.9 | worse |

- With 2,000 games the standard error of the average rank is about 0.025. So the first two tests
  are equal to the baseline, and the last one is clearly worse (about 5 standard errors).
- The training self-play (with Boltzmann exploration) averaged about 2.55 over the last 50 rounds.
- The final `trainee.pth` (step 147,600) is not tested; it should not be assumed better than
  `best.pth`.
- The run gave no measurable gain. It also drifted to worse after about 6 h. Likely causes, not yet
  separated:
  - a learning rate too high for continuing an already converged model;
  - the new reward scale (balance points instead of the avoid-4th points the model was trained
    with);
  - the trainee learning to exploit the frozen baseline rather than getting stronger.

Problems found in the run:

- **Auto power-off did not happen.** AutoDL's `/usr/bin/shutdown` is a shell script without a
  shebang, so `subprocess.run(["shutdown", ...])` fails with `Exec format error`. The instance
  stayed on (and billed) after 14:31. Fixed: `overnight.py` now runs it through `sh -c`.
- **Clients crashed twice** (09:39, 14:07; both restarted by `overnight.py`). Both clients shared
  `train_play/log_dir`, and a client wipes that folder at the start of each round, deleting files
  the other was about to read. Fixed: each client gets its own `[train_play.clientN]` profile
  (`TRAIN_PLAY_PROFILE`, a Mortal feature) with its own `log_dir`.

### Control experiment (started 2026-10-29 17:39 CST)

Two runs side by side, each changing one thing from the first run. Each has 1 client, starts again
from Akagi's checkpoint, and reuses `runs/balance/grp.pth`. GRP predicts ranks only, so it does
not depend on the style.

| Run | pts | lr | Question |
|---|---|---|---|
| `ctl_a` | avoid4 (same as the starting model) | 1e-5 (same as the first run) | was the reward change the cause? |
| `ctl_b` | balance (same as the first run) | 3e-6 | was the learning rate the cause? |

- Both test every 10,000 steps (2,000 games), stop at 23:39 CST, and then `ctl.sh` powers the
  machine off.
- Note: the learning rate of the first run was a constant 1e-5. The scheduler state comes from the
  config, because prepare.py starts the online phase without the offline optimizer and scheduler.
- New `overnight.py` options for this: `--name`, `--lr`, `--test-every`, `--grp-from`. Several runs
  can share the machine with different `--name` and `--port`.
- With one client each, every run gets about half the games of the first run, so expect about
  4,000 steps/h per run.

### Results

Both runs stopped at about 23:38 CST at about +26,000 / +25,000 steps (about 4,300 steps/h each).
`ctl.sh` then powered the machine off: the `sh -c` fix works. There were no client crashes with
the per-client `log_dir`. Each run got only two tests: the third (at 120,000) was not reached.

| Run | Test at 100,000 | Test at 110,000 | Training games, last 50 rounds (about 40,000 games) |
|---|---|---|---|
| `ctl_a` avoid4, lr 1e-5 | 2.511 | 2.542 | 2.523 |
| `ctl_b` balance, lr 3e-6 | 2.539 | 2.500 | 2.515 |

Reading it together with the first run (2.502, 2.496, then 2.627):

- **No test of any run is better than the baseline** beyond noise (±0.025). Seven tests average
  about 2.52.
- **Neither variable explains it.**
  - With the original reward (`ctl_a`), the trainee is not better.
  - With a 3× lower learning rate (`ctl_b`), it is not better either.
  - The first run's drift to 2.627 came only after about 50,000 steps, which these short runs
    don't reach.
- The training games are a much larger sample (SE about 0.006) and are slightly worse than 2.5.
  This fits: they are played with Boltzmann exploration on.
- `best.pth` is the maximum of a few noisy tests, so it is biased upward. It is not evidence of a
  better model.

Conclusion: continuing Akagi's model with 1v3 online RL against a frozen copy of itself gives no
measurable gain at this scale (tens of thousands of steps, a day of a 5090). The model is already
converged for what this setup can teach it. More GPU hours on the same recipe are not a good use of
money. See section 10 for what to do instead.

### Does `pts` change the style? (analysis, 2026-10-30)

The question here is not strength. It is whether `pts` changes how the trainee plays.

- **Data**: each client logs the trainee's rank counts after every round of 800 games
  (`trainee rankings: [n1 n2 n3 n4]`). There are about 185,000 games for `balance` and about 84,000
  each for `ctl_a` and `ctl_b`.
- **Why it works**: the games are played in all four seat rotations of each seed. A trainee equal
  to the baseline therefore sits at 25 % per rank, and this is visible in the first rounds of every
  run. A style shows up as a different shape: more 1st and 4th (risky), or more 2nd and 3rd (safe).
- **Caveats**: these are training games with Boltzmann exploration on. Rotations of one seed are
  correlated. ±0.26 % is the naive standard error per 28,000 games.

Rates over the last 4 h of each control run:

| Run | 1st + 4th | 1st − 4th | Score with avoid4 pts | Score with balance pts |
|---|---|---|---|---|
| `ctl_a` (avoid4 pts) | 48.6 % | −1.0 % | **−0.018** | −0.031 |
| `ctl_b` (balance pts) | 51.7 % | −1.0 % | −0.059 | **−0.024** |

- **Yes: `pts` moves the style, in the expected direction.**
  - The balance-trained model takes more extreme results (1st + 4th 3.1 points higher, about
    8 standard errors).
  - The avoid4-trained model moves to the middle ranks (2nd + 3rd 51.4 %).
- **Each model scores better than the other under its own points.** Neither beats the baseline
  under any points: both are slightly weaker overall, as the tests showed.
- **The effect is small**: a few percentage points after about 25,000 steps. A player in Hibari
  will barely notice it.
- **The first `balance` run does not show the shape clearly.** Its later hours are dominated by the
  loss of strength (1st falls to 21 %, 4th rises to 28 %).

Takeaway: style training works in principle, but it costs strength, and the shift is small at this
budget. To make it visible, use more extreme `pts`, for example a "top" style such as
`[6, 1, -1, -6]` or `[8, 0, -2, -6]`. Also pair it with a lower learning rate, so that it changes
the style without the drift seen in the first run.

## 10. Next steps

1. Read `overnight.log`: did every stage complete, how many trainee steps were reached?
2. Evaluate: `one_vs_three.py` with the challenger = `runs/balance/trainee.pth` and the champion =
   `baseline.pth`, a few thousand games. Compare average rank and the rates of 1st and 4th place
   with the baseline's own numbers. For `balance` we expect fewer avoid-4th habits: more 1st,
   somewhat more 4th.
3. If the shift is in the expected direction, continue training (`overnight.py` resumes in place)
   and then train `top` the same way. If not, revisit `pts`, the exploration settings or the
   amount of data before spending more.
4. To use a trained model in Hibari, copy the `mjbot_mortal` folder, replace `mortal.pth` with the
   trained checkpoint, and point Settings → AI 程序 at the new folder. The loader reads `mortal`,
   `current_dqn` and `config` from the file, all present in our checkpoints. Per-AI model
   selection in Hibari is a possible follow-up.

## 11. TODO

> **On hold since 2026-10-30.** The control experiment (section 9) showed that this recipe does not
> improve on the starting model. The style plan below would spend 1–2 days per style on the same
> recipe, so it waits until the open question is answered: does `pts` change the style at all,
> even without a gain in strength? A test for that is to compare the 1st / 4th place rates of a
> `top` and an `avoid4` run, not their average rank. Done in the meantime: GRP is shared
> (`--grp-from`), and every client has its own `log_dir`.

Training plan:

- [ ] **Train all three styles with the same budget**, including a new `avoid4`. Akagi's model is
  already avoid-4th leaning, but it was trained offline on human logs while ours get online
  self-play on top. With equal training, differences between our three models come from `pts`
  alone. The new `avoid4` is the control group, and it may also end up stronger than the original.
- [ ] **Order: `balance` (running) → `top` → `avoid4`.** `top` differs most from the original, so
  it shows most clearly whether `pts` works. Each gets the same time, e.g. 1–2 days.
- [ ] **Evaluate after each style.** Play `one_vs_three.py` against the original `baseline.pth`
  for a few thousand games and compare average rank and the 1st / 4th place rates. Fill the
  results in here.

Pipeline improvements (from the speed test and the first night):

- [ ] **Generate GRP logs in parallel.** One `one_vs_three.py` process only uses about 11 of 25
  cores. Run two at once, each with its own `log_dir` (subfolders under `grp_logs/`, matched by
  the `**` glob). Same-named files from the same seed range would overwrite each other in a
  shared folder. This should make the step nearly twice as fast.
- [ ] **Share GRP across styles.** GRP only predicts final ranks from the game state; `pts` is
  applied afterwards in the reward. All styles start from the same baseline, so the GRP logs and
  `grp.pth` from the `balance` run can be reused for `top` and `avoid4` (copy them into the new
  run folder, or point `[grp]` / `[grp.dataset]` at the shared ones). That saves about 1.5 h per
  style.
- [ ] **Try 3 self-play clients.** 2 clients use about 19.5 of 25 cores, so a third may add
  10–20 % throughput. Measure it at the start of the next run (`speedtest.py --max-clients 3`).
- [ ] **Prefer CPU over GPU when renting.** Self-play is CPU-bound (GPU about 23 % busy with 2
  clients), so a machine with more cores and a cheaper GPU may be more cost-effective.

Hibari side:

- [ ] **Per-AI model selection** in Settings: AI-A / B / C each pick a bot folder (e.g. top /
  balance / avoid4), so the three opponents play different styles.
