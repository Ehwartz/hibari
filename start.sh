#!/bin/sh
# Hibari (Linux / macOS): starts the backend and opens the app window.
# Logs: data/launcher.log, data/server.log
cd "$(dirname "$0")" || exit 1
if [ ! -x .venv/bin/python ]; then
  if ! command -v uv >/dev/null 2>&1; then
    echo "需要先安装 uv：curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
    exit 1
  fi
  uv sync || exit 1
fi
exec .venv/bin/python -m scripts.launch
