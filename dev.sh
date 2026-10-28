#!/bin/sh
# Development (Linux / macOS): backend with auto-reload on :8000 + Vite dev server on :5173.
# Ctrl+C stops both.
cd "$(dirname "$0")" || exit 1
[ -d frontend/node_modules ] || (cd frontend && npm install) || exit 1
uv run uvicorn backend.server.app:app --reload --port 8000 &
BACKEND=$!
trap 'kill $BACKEND 2>/dev/null' EXIT INT TERM
cd frontend && npm run dev
