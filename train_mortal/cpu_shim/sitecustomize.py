"""CPU-only testing of Mortal: pinned memory (CUDA-only) becomes plain memory.

Mortal assumes a GPU and pins host memory (`pin_memory=True`, `.pin_memory()`), which raises without
CUDA. pilot.py puts this folder on PYTHONPATH when there is no GPU, so every process, including the
DataLoader workers Windows starts fresh, applies the patch at startup. GPU runs never load it.
"""
import torch

if not torch.cuda.is_available():
    _tensor = torch.tensor

    def _tensor_no_pin(*args, pin_memory=False, **kwargs):
        return _tensor(*args, **kwargs)

    torch.tensor = _tensor_no_pin
    torch.Tensor.pin_memory = lambda self, *a, **k: self
    # GPU-only housekeeping calls in Mortal's loops become no-ops
    torch.cuda.synchronize = lambda *a, **k: None
    torch.cuda.empty_cache = lambda *a, **k: None
