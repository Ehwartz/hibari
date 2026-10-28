"""Unattended run: GRP logs -> GRP -> online training of one style until a deadline, then stop
(and optionally power the machine off, which ends billing on AutoDL-style clouds).

    python overnight.py --style balance --hours 8 [--grp-games 24000] [--grp-minutes 30] [--clients 2] [--shutdown]

Everything goes to runs/<style>/ (log: runs/<style>/overnight.log). Crashed clients / server are
restarted; train.py restarts itself. Re-running continues where it left off: existing GRP logs,
grp.pth and trainee.pth are kept.
"""
from __future__ import annotations

import argparse
import glob
import os
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
    ap.add_argument("--shutdown", action="store_true", help="power the machine off at the end")
    args = ap.parse_args()

    deadline = time.time() + args.hours * 3600
    work = HERE / "runs" / args.style
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
        return subprocess.Popen([sys.executable, script], cwd=MORTAL, env=env, stdout=out, stderr=subprocess.STDOUT,
                                start_new_session=True)

    def trainee_steps() -> int:
        return torch.load(work / "trainee.pth", map_location="cpu", weights_only=True)["steps"]

    make_config.SCALES["full"].update(games_1v3=args.grp_games)
    (work / "config.toml").write_text(make_config.config_text(work, args.style, "full", "cuda:0", True, args.port), encoding="utf-8")
    subprocess.run([sys.executable, str(HERE / "prepare.py"), "--work", str(work), "--amp"], check=True)
    log(f"start: style {args.style} pts {make_config.STYLES[args.style]}, deadline {time.strftime('%H:%M', time.localtime(deadline))}")

    try:
        # 1. GRP logs
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
            subprocess.run(["shutdown", "-h", "now"])


if __name__ == "__main__":
    main()
