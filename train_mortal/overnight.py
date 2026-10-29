"""Unattended run: GRP logs -> GRP -> online training of one style until a deadline, then stop
(and optionally power the machine off, which ends billing on AutoDL-style clouds).

    python overnight.py --style balance --hours 8 [--grp-games 24000] [--grp-minutes 30] [--clients 2] [--shutdown]
    python overnight.py --style avoid4 --name ctl_a --grp-from runs/balance --lr 1e-5 --test-every 10000 --port 5001 --clients 1 --hours 6

Everything goes to runs/<name>/ (default name: the style; log: runs/<name>/overnight.log). --grp-from
reuses another run's grp.pth (GRP predicts ranks only, so it does not depend on the style) and skips
the GRP phases. Several runs can share the machine with different --name and --port. Crashed clients / server are
restarted; train.py restarts itself. Re-running continues where it left off: existing GRP logs,
grp.pth and trainee.pth are kept.
"""
from __future__ import annotations

import argparse
import glob
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import torch

import make_config
from pilot import HERE, MORTAL, stop


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--style", choices=list(make_config.STYLES), default="balance")
    ap.add_argument("--hours", type=float, required=True, help="total time budget from now")
    ap.add_argument("--grp-games", type=int, default=24000)
    ap.add_argument("--grp-minutes", type=float, default=30)
    ap.add_argument("--clients", type=int, default=2)
    ap.add_argument("--port", type=int, default=5000)
    ap.add_argument("--name", help="run folder under runs/ (default: the style)")
    ap.add_argument("--lr", type=float, default=1e-5, help="online learning rate (constant)")
    ap.add_argument("--test-every", type=int, default=20000, help="steps between 1v3 tests against the baseline")
    ap.add_argument("--grp-from", type=Path, help="run folder whose grp.pth to reuse")
    ap.add_argument("--shutdown", action="store_true", help="power the machine off at the end")
    args = ap.parse_args()

    deadline = time.time() + args.hours * 3600
    work = HERE / "runs" / (args.name or args.style)
    (work / "logs").mkdir(parents=True, exist_ok=True)
    logf = open(work / "overnight.log", "a", encoding="utf-8")

    def log(msg: str) -> None:
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
        print(line, flush=True)
        logf.write(line + "\n")
        logf.flush()

    env = {**os.environ, "MORTAL_CFG": str(work / "config.toml"), "PYTHONUNBUFFERED": "1",
           "PYTHONPATH": os.pathsep.join(filter(None, [str(HERE / "mortal_shim"), os.environ.get("PYTHONPATH")]))}

    def start(name: str, script: str) -> subprocess.Popen:
        out = open(work / "logs" / f"{name}.log", "a", encoding="utf-8")
        # each client its own train_play profile (log_dir): a client wipes its log_dir at the start of a round
        penv = {**env, "TRAIN_PLAY_PROFILE": name} if name.startswith("client") else env
        return subprocess.Popen([sys.executable, script], cwd=MORTAL, env=penv, stdout=out, stderr=subprocess.STDOUT,
                                start_new_session=True)

    def trainee_steps() -> int:
        return torch.load(work / "trainee.pth", map_location="cpu", weights_only=True)["steps"]

    make_config.SCALES["full"].update(games_1v3=args.grp_games, test_every=args.test_every)
    cfg = make_config.config_text(work, args.style, "full", "cuda:0", True, args.port)
    cfg = cfg.replace("peak = 1e-5\nfinal = 1e-5", f"peak = {args.lr:g}\nfinal = {args.lr:g}")
    default = cfg.split("[train_play.default]\n", 1)[1].split("\n\n", 1)[0]
    for i in range(1, args.clients + 1):
        cfg += f"\n[train_play.client{i}]\n" + default.replace("train_play'", f"train_play_{i}'") + "\n"
    (work / "config.toml").write_text(cfg, encoding="utf-8")
    subprocess.run([sys.executable, str(HERE / "prepare.py"), "--work", str(work), "--amp"], check=True)
    if args.grp_from and not (work / "grp.done").exists():
        shutil.copy2(args.grp_from / "grp.pth", work / "grp.pth")
        (work / "grp.done").touch()
    log(f"start: style {args.style} pts {make_config.STYLES[args.style]}, lr {args.lr:g}, "
        f"test every {args.test_every}, deadline {time.strftime('%H:%M', time.localtime(deadline))}")

    try:
        # 1. GRP logs
        if not (work / "grp.done").exists():
            n = len(glob.glob(str(work / "grp_logs" / "**" / "*.json.gz"), recursive=True))
            if n < args.grp_games * 0.9:
                log(f"GRP logs: {args.grp_games} games of 1v3 self-play")
                with open(work / "logs" / "1v3.log", "a") as out:
                    subprocess.run([sys.executable, "one_vs_three.py"], cwd=MORTAL, env=env, stdout=out, stderr=subprocess.STDOUT, check=True)
                n = len(glob.glob(str(work / "grp_logs" / "**" / "*.json.gz"), recursive=True))
            log(f"GRP logs ready: {n} games")

        # 2. GRP
        if not (work / "grp.pth").exists() or not (work / "grp.done").exists():
            log(f"GRP training for {args.grp_minutes:.0f} min")
            p = start("grp", "train_grp.py")
            end = min(deadline, time.time() + args.grp_minutes * 60)
            while time.time() < end and p.poll() is None:
                time.sleep(10)
            stop(p)
            if not (work / "grp.pth").exists():
                raise SystemExit("no grp.pth: see logs/grp.log")
            (work / "grp.done").touch()
        steps = torch.load(work / "grp.pth", map_location="cpu", weights_only=True)["steps"]
        log(f"GRP ready: {steps} steps")

        # 3. online training until the deadline, restarting anything that dies
        start_steps = trainee_steps()
        procs = {"server": start("server", "server.py")}
        time.sleep(5)
        procs["trainer"] = start("trainer", "train.py")
        time.sleep(10)
        for i in range(1, args.clients + 1):
            procs[f"client{i}"] = start(f"client{i}", "client.py")
        log(f"online training: {args.clients} clients, trainee starts at step {start_steps}")
        last_report = time.time()
        while time.time() < deadline - 120:
            time.sleep(30)
            for name, p in list(procs.items()):
                if p.poll() is not None:
                    log(f"{name} exited with {p.returncode}: restarting")
                    procs[name] = start(name, f"{'client' if name.startswith('client') else name}.py")
            if time.time() - last_report > 1800:
                last_report = time.time()
                log(f"progress: trainee step {trainee_steps()} (+{trainee_steps() - start_steps})")
        for p in procs.values():
            stop(p)
        log(f"stopped at the deadline: trainee step {trainee_steps()} (+{trainee_steps() - start_steps}); "
            f"model: {work / 'trainee.pth'}")
    except BaseException as ex:
        log(f"FAILED: {ex!r}")
        raise
    finally:
        if args.shutdown:
            log("powering off")
            logf.close()
            # AutoDL's /usr/bin/shutdown is a shell script without a shebang: exec fails, so go through sh
            subprocess.run(["sh", "-c", "shutdown -h now"])


if __name__ == "__main__":
    main()
