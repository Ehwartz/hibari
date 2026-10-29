#!/bin/bash
# Control experiment of 2026-10-29 (TRAINING_NOTES section 9): two runs side by side, each changing
# one thing from the first balance run, then power the machine off once both have stopped.
#   A = avoid4 pts @ lr 1e-5, B = balance pts @ lr 3e-6; 1 client each, GRP reused from runs/balance.
# Start detached:  nohup ./control.sh > control.out 2>&1 &
cd "$(dirname "$0")"
.venv/bin/python overnight.py --style avoid4 --name ctl_a --grp-from runs/balance --lr 1e-5 --test-every 10000 --port 5001 --clients 1 --hours 6 > ctl_a.out 2>&1 &
sleep 60
.venv/bin/python overnight.py --style balance --name ctl_b --grp-from runs/balance --lr 3e-6 --test-every 10000 --port 5002 --clients 1 --hours 6 > ctl_b.out 2>&1 &
wait
echo "both done $(date)"
sh -c "shutdown -h now"  # AutoDL's shutdown has no shebang: call it through sh
