"""Throughput test at full scale, to size the real run (how many clients, games and hours).

    python speedtest.py [--games 800] [--grp-seconds 120] [--phase-seconds 360] [--max-clients 2]

Under runs/speed: 1v3 self-play of --games games (also the GRP data), a short GRP training, then
online training with 1, 2, ... --max-clients self-play clients for --phase-seconds each. Reports
games/hour, trainer steps/second, buffer overflows, and GPU utilisation / CPU cores used per phase.
"""
from __future__ import annotations

import argparse
import glob
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

import torch

import make_config
from pilot import HERE, MORTAL, mortal_env, stop

WORK = HERE / "runs" / "speed"


class Sampler:
    """GPU utilisation (nvidia-smi) and CPU cores used (cgroup v2 usage_usec) every few seconds."""

    def __init__(self) -> None:
        self.gpu: list[float] = []
        self.cores: list[float] = []
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)

    @staticmethod
    def _cpu_usec() -> int | None:
        try:
            for line in Path("/sys/fs/cgroup/cpu.stat").read_text().splitlines():
                if line.startswith("usage_usec"):
                    return int(line.split()[1])
        except OSError:
            return None
        return None

    def _run(self) -> None:
        last = (time.time(), self._cpu_usec())
        while not self._stop.wait(5):
            out = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
                                 capture_output=True, text=True).stdout.strip()
            if out:
                self.gpu.append(float(out.splitlines()[0]))
            now = (time.time(), self._cpu_usec())
            if now[1] is not None and last[1] is not None:
                self.cores.append((now[1] - last[1]) / 1e6 / (now[0] - last[0]))
            last = now

    def __enter__(self):
        self._t.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self._t.join()

    def summary(self) -> str:
        avg = lambda xs: sum(xs) / len(xs) if xs else float("nan")
        return f"GPU {avg(self.gpu):.0f}% avg (max {max(self.gpu, default=0):.0f}%), CPU {avg(self.cores):.1f} cores avg"


def start(name: str, script: str) -> subprocess.Popen:
    log = open(WORK / "logs" / f"{name}.log", "w", encoding="utf-8")
    return subprocess.Popen([sys.executable, script], cwd=MORTAL, env=mortal_env_speed(), stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)


def mortal_env_speed() -> dict[str, str]:
    env = mortal_env()
    env["MORTAL_CFG"] = str(WORK / "config.toml")
    return env


def steps() -> int:
    return torch.load(WORK / "trainee.pth", map_location="cpu", weights_only=True)["steps"]


def submissions(name: str) -> int:
    return (WORK / "logs" / f"{name}.log").read_text(errors="replace").count("logs have been submitted")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=800, help="games per 1v3 run and per client round")
    ap.add_argument("--grp-seconds", type=int, default=120)
    ap.add_argument("--phase-seconds", type=int, default=360)
    ap.add_argument("--max-clients", type=int, default=2)
    args = ap.parse_args()

    if WORK.exists():
        shutil.rmtree(WORK)
    (WORK / "logs").mkdir(parents=True)
    make_config.SCALES["full"].update(games_1v3=args.games, train_games=args.games)
    (WORK / "config.toml").write_text(make_config.config_text(WORK, "avoid4", "full", "cuda:0", True, 5077), encoding="utf-8")
    subprocess.run([sys.executable, str(HERE / "prepare.py"), "--work", str(WORK), "--amp"], check=True)
    report = []

    print(f"\n==> 1v3 self-play, {args.games} games", flush=True)
    t = time.time()
    with Sampler() as s, open(WORK / "logs" / "1v3.log", "w") as log:
        subprocess.run([sys.executable, "one_vs_three.py"], cwd=MORTAL, env=mortal_env_speed(), stdout=log,
                       stderr=subprocess.STDOUT, check=True)
    secs = time.time() - t
    n = len(glob.glob(str(WORK / "grp_logs" / "**" / "*.json.gz"), recursive=True))
    report.append(f"1v3: {n} games in {secs:.0f}s = {n / secs * 3600:,.0f} games/hour | {s.summary()}")
    print(report[-1], flush=True)

    print(f"\n==> GRP {args.grp_seconds}s", flush=True)
    p = start("grp", "train_grp.py")
    time.sleep(args.grp_seconds)
    stop(p)
    grp = torch.load(WORK / "grp.pth", map_location="cpu", weights_only=True)
    report.append(f"GRP: {grp['steps']} steps in {args.grp_seconds}s (batch 512)")
    print(report[-1], flush=True)

    print("\n==> online training", flush=True)
    procs = [start("server", "server.py")]
    time.sleep(3)
    procs.append(start("trainer", "train.py"))
    time.sleep(5)
    try:
        for k in range(1, args.max_clients + 1):
            procs.append(start(f"client{k}", "client.py"))
            # let the new client finish its first round before measuring
            while submissions(f"client{k}") == 0:
                time.sleep(5)
            s0, t0 = steps(), time.time()
            subs0 = {i: submissions(f"client{i}") for i in range(1, k + 1)}
            over0 = (WORK / "logs" / "server.log").read_text(errors="replace").count("overflow")
            with Sampler() as s:
                time.sleep(args.phase_seconds)
            dt = time.time() - t0
            rounds = sum(submissions(f"client{i}") - subs0[i] for i in range(1, k + 1))
            over = (WORK / "logs" / "server.log").read_text(errors="replace").count("overflow") - over0
            busy = re.findall(r"(\d+\.\d+)batch/s", (WORK / "logs" / "trainer.log").read_text(errors="replace"))
            report.append(
                f"{k} client(s): {rounds} rounds x {args.games} games in {dt:.0f}s = {rounds * args.games / dt * 3600:,.0f} games/hour | "
                f"trainer +{steps() - s0} saved steps ({(steps() - s0) / dt:.2f}/s; last rate {busy[-1] if busy else '?'} batch/s) | "
                f"overflow msgs {over} | {s.summary()}")
            print(report[-1], flush=True)
    finally:
        for p in reversed(procs):
            stop(p)

    print("\n==> speed test summary")
    for line in report:
        print("  " + line)
    print("SPEEDTEST DONE")


if __name__ == "__main__":
    main()
