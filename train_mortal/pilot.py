"""End-to-end pilot of the training pipeline, with timings to size the real run.

    python pilot.py [--device cpu|cuda:0] [--amp] [--grp-seconds 60] [--online-seconds 240]

Steps (all under runs/pilot, nothing else is touched):
 1. config (make_config.py --scale pilot) + starting weights (prepare.py)
 2. GRP logs: Akagi's model vs itself in libriichi's 1v3 arena -> games per second
 3. GRP training for a short while -> grp.pth must appear
 4. online training: server + one self-play client + trainer for a few minutes -> logs must flow
    from the client through the server to the trainer, and the trainer must save new steps
Each process logs to runs/pilot/logs/<name>.log. Run from anywhere; Mortal is in ./Mortal.
"""
from __future__ import annotations

import argparse
import glob
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import torch

HERE = Path(__file__).resolve().parent
MORTAL = HERE / "Mortal" / "mortal"
WORK = HERE / "runs" / "pilot"
IS_WIN = sys.platform == "win32"


def step(msg: str) -> None:
    print(f"\n==> {msg}", flush=True)


def mortal_env(**extra: str) -> dict[str, str]:
    env = {**os.environ, "MORTAL_CFG": str(WORK / "config.toml"), "PYTHONUNBUFFERED": "1", **extra}
    # runtime fixes for Mortal on this machine (spawned workers with CUDA, no-op CUDA calls on a CPU)
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(HERE / "mortal_shim"), env.get("PYTHONPATH")]))
    return env


def start(name: str, script: str, **extra: str) -> subprocess.Popen:
    log = open(WORK / "logs" / f"{name}.log", "w", encoding="utf-8")
    kw = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if IS_WIN else {"start_new_session": True}
    return subprocess.Popen([sys.executable, script], cwd=MORTAL, env=mortal_env(**extra), stdout=log,
                            stderr=subprocess.STDOUT, **kw)


def stop(p: subprocess.Popen) -> None:
    """Stop a process and its children (train.py re-spawns itself as a child)."""
    if p.poll() is not None:
        return
    if IS_WIN:
        subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
    else:
        os.killpg(p.pid, signal.SIGTERM)
    try:
        p.wait(15)
    except subprocess.TimeoutExpired:
        p.kill()


def tail(name: str, n: int = 12) -> str:
    lines = (WORK / "logs" / f"{name}.log").read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join("    " + line[-200:] for line in lines[-n:])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--amp", action="store_true")
    ap.add_argument("--grp-seconds", type=int, default=60)
    ap.add_argument("--online-seconds", type=int, default=240)
    ap.add_argument("--port", type=int, default=5055)
    args = ap.parse_args()

    if WORK.exists():
        shutil.rmtree(WORK)
    (WORK / "logs").mkdir(parents=True)
    report: dict[str, str] = {}

    step("1/4 config + starting weights")
    amp = ["--amp"] if args.amp else []
    subprocess.run([sys.executable, str(HERE / "make_config.py"), "--work", str(WORK), "--scale", "pilot",
                    "--device", args.device, "--port", str(args.port), *amp], check=True)
    subprocess.run([sys.executable, str(HERE / "prepare.py"), "--work", str(WORK), *amp], check=True)

    step("2/4 GRP logs: 1v3 self-play")
    t = time.time()
    with open(WORK / "logs" / "1v3.log", "w", encoding="utf-8") as log:
        r = subprocess.run([sys.executable, "one_vs_three.py"], cwd=MORTAL, env=mortal_env(), stdout=log, stderr=subprocess.STDOUT)
    secs = time.time() - t
    logs = glob.glob(str(WORK / "grp_logs" / "**" / "*.json.gz"), recursive=True)
    print(tail("1v3", 6))
    if r.returncode != 0 or not logs:
        raise SystemExit(f"1v3 failed (exit {r.returncode}, {len(logs)} logs); see {WORK / 'logs' / '1v3.log'}")
    report["1v3 self-play"] = f"{len(logs)} games in {secs:.0f}s ({len(logs) / secs * 3600:.0f} games/hour incl. model load)"

    step(f"3/4 GRP training for {args.grp_seconds}s")
    p = start("grp", "train_grp.py")
    time.sleep(args.grp_seconds)
    stop(p)
    print(tail("grp", 6))
    grp = WORK / "grp.pth"
    if not grp.exists():
        raise SystemExit(f"no grp.pth after {args.grp_seconds}s; see {WORK / 'logs' / 'grp.log'}")
    report["GRP"] = f"{torch.load(grp, map_location='cpu', weights_only=True)['steps']} steps in {args.grp_seconds}s"

    step(f"4/4 online training for {args.online_seconds}s (server + client + trainer)")
    steps_before = torch.load(WORK / "trainee.pth", map_location="cpu", weights_only=True)["steps"]
    procs = [start("server", "server.py")]
    time.sleep(3)
    procs.append(start("trainer", "train.py"))
    time.sleep(3)
    procs.append(start("client", "client.py"))
    t0 = time.time()
    try:
        while time.time() - t0 < args.online_seconds:
            time.sleep(10)
            dead = [n for n, p in zip(("server", "trainer", "client"), procs) if p.poll() is not None and n != "trainer"]
            if dead:
                raise SystemExit(f"{dead} exited early; see {WORK / 'logs'}")
    finally:
        for p in reversed(procs):
            stop(p)
    for n in ("server", "client", "trainer"):
        print(f"  [{n}]\n{tail(n, 8)}")
    steps_after = torch.load(WORK / "trainee.pth", map_location="cpu", weights_only=True)["steps"]
    played = sum(1 for _ in glob.glob(str(WORK / "buffer" / "*"))) + sum(1 for _ in glob.glob(str(WORK / "drain" / "*")))
    report["online"] = (f"trainee steps {steps_before} -> {steps_after} in {args.online_seconds}s; "
                        f"self-play logs still in buffer/drain: {played}")

    step("pilot summary")
    for k, v in report.items():
        print(f"  {k}: {v}")
    if steps_after <= steps_before:
        raise SystemExit("the trainer saved no new steps: see runs/pilot/logs/trainer.log")
    print("PILOT PASSED")


if __name__ == "__main__":
    main()
