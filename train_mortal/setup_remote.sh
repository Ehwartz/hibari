#!/bin/sh
# One-time setup of the training environment on a rented Linux GPU box. Run from train_mortal/:
#     sh setup_remote.sh
# Python 3.12 (uv) with CUDA PyTorch 2.8, Rust, and libriichi compiled from Mortal's sources (the
# prebuilt Linux libriichi needs glibc 2.39; Ubuntu 22.04 images have 2.35). Safe to re-run.
#
# On mainland-China clouds (detected by AutoDL's /etc/network_turbo, or CN_MIRRORS=1) every download
# goes through domestic mirrors: the platform's own proxy speeds up GitHub but slows everything else.
set -e
cd "$(dirname "$0")"
HERE=$(pwd)
if [ "${CN_MIRRORS:-}" = 1 ] || { [ -z "${CN_MIRRORS:-}" ] && [ -f /etc/network_turbo ]; }; then
  echo "==> using mainland-China mirrors"
  export UV_PYTHON_INSTALL_MIRROR=https://registry.npmmirror.com/-/binary/python-build-standalone
  export UV_DEFAULT_INDEX=https://mirrors.aliyun.com/pypi/simple
  TORCH_INDEX="--find-links https://mirrors.aliyun.com/pytorch-wheels/cu128/"
  export RUSTUP_DIST_SERVER=https://rsproxy.cn RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
  RUSTUP_INIT=https://rsproxy.cn/rustup-init.sh
  mkdir -p "$HOME/.cargo"
  cat > "$HOME/.cargo/config.toml" <<'TOML'
[source.crates-io]
replace-with = "rsproxy-sparse"
[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"
[net]
git-fetch-with-cli = true
TOML
else
  TORCH_INDEX="--index-url https://download.pytorch.org/whl/cu128"
  RUSTUP_INIT=https://sh.rustup.rs
fi

echo "==> uv + Python 3.12 venv"
command -v uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
[ -x .venv/bin/python ] || uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python "torch==2.8.*" $TORCH_INDEX
uv pip install --python .venv/bin/python toml tqdm tensorboard numpy

echo "==> Rust + libriichi"
command -v cargo >/dev/null 2>&1 || [ -x "$HOME/.cargo/bin/cargo" ] || curl --proto '=https' --tlsv1.2 -sSf "$RUSTUP_INIT" | sh -s -- -y --profile minimal
. "$HOME/.cargo/env"
cd Mortal
PYO3_PYTHON="$HERE/.venv/bin/python" cargo build -p libriichi --lib --release
cp target/release/libriichi.so mortal/libriichi.so
cd "$HERE"

echo "==> check"
.venv/bin/python - <<'PY'
import sys
sys.path.insert(0, "Mortal/mortal")
import torch, libriichi
from libriichi.arena import OneVsThree
from libriichi.dataset import Grp, GameplayLoader
print("libriichi ok | torch", torch.__version__, "| cuda", torch.version.cuda, "|", torch.cuda.get_device_name(0))
x = torch.randn(1024, 1024, device="cuda")
print("gpu matmul ok:", float((x @ x).sum()) == float((x @ x).sum()))
PY
echo "setup done"
