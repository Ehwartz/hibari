"""Put the starting weights into a run folder: baseline.pth (the frozen opponents) and trainee.pth
(where online training starts and keeps saving), both from Akagi's mortal.pth.

    python prepare.py --work runs/avoid4 [--weights ../mjbot_mortal/mortal.pth] [--amp]

Akagi's file is a full Mortal training checkpoint (mortal, current_dqn, aux_net, optimizer, scheduler,
scaler, steps, config) from an offline run. It holds a few numpy scalars (e.g. best_perf), which
Mortal's `torch.load(..., weights_only=True)` everywhere refuses, so it is read once with
weights_only=False (the same file Hibari already loads that way) and saved back with plain Python
numbers, then re-checked in safe mode. Online training restores the AMP `scaler` from it
unconditionally, and an empty one (that run had AMP off) is rejected by an enabled GradScaler, so with
--amp the trainee gets a fresh scaler state. Optimizer / scheduler are not restored when the saved
run was offline, which is what we want for the online phase.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent


def plain(x):
    """numpy scalars / arrays -> Python numbers / lists, recursively (tensors untouched)."""
    if isinstance(x, dict):
        return {k: plain(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return type(x)(plain(v) for v in x)
    if isinstance(x, np.generic):
        return x.item()
    if isinstance(x, np.ndarray):
        return x.tolist()
    return x


def save_clean(state: dict, path: Path) -> None:
    torch.save(state, path)
    torch.load(path, map_location="cpu", weights_only=True)  # what Mortal does: must not raise


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--weights", type=Path, default=HERE.parent / "mjbot_mortal" / "mortal.pth")
    ap.add_argument("--amp", action="store_true")
    args = ap.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)

    state = plain(torch.load(args.weights, map_location="cpu", weights_only=False))
    missing = {"mortal", "current_dqn", "aux_net", "scaler", "steps", "timestamp", "best_perf", "config"} - state.keys()
    if missing:
        raise SystemExit(f"not a Mortal training checkpoint, missing: {sorted(missing)}")
    cfg = state["config"]
    print(f"weights: {args.weights} | version {cfg['control'].get('version')} | resnet {cfg['resnet']} | "
          f"steps {state['steps']} | pts {cfg.get('env', {}).get('pts')}")

    baseline = args.work / "baseline.pth"
    save_clean(state, baseline)

    trainee = args.work / "trainee.pth"
    if trainee.exists():
        print(f"{trainee} exists (training already started): kept")
    else:
        if args.amp:
            state["scaler"] = torch.amp.GradScaler("cuda", enabled=True).state_dict()
        save_clean(state, trainee)
    print(f"baseline: {baseline}\ntrainee:  {trainee}")


if __name__ == "__main__":
    main()
