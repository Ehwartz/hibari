"""Runtime fixes for running Mortal's scripts unmodified, loaded through PYTHONPATH (pilot.py does
this; for manual runs: export PYTHONPATH=/path/to/train_mortal/mortal_shim).

With CUDA (Linux): child processes start with "spawn" instead of "fork". Mortal's DataLoader workers
pin memory (CUDA), and a forked child of a process that already initialised CUDA fails with
"CUDA error: initialization error".

Without CUDA (testing the pipeline on a CPU): pinned memory becomes plain memory and the GPU-only
housekeeping calls become no-ops. Every process loads this file at startup, including the DataLoader
workers Windows starts fresh.
"""
import multiprocessing
import sys

import torch

if torch.cuda.is_available():
    if sys.platform != "win32":
        multiprocessing.set_start_method("spawn", force=True)
else:
    _tensor = torch.tensor

    def _tensor_no_pin(*args, pin_memory=False, **kwargs):
        return _tensor(*args, **kwargs)

    torch.tensor = _tensor_no_pin
    torch.Tensor.pin_memory = lambda self, *a, **k: self
    torch.cuda.synchronize = lambda *a, **k: None
    torch.cuda.empty_cache = lambda *a, **k: None
