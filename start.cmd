@echo off
rem Mahjong AI Trainer: opens the app in its own window (Chrome app mode).
rem Logs: data\launcher.log, data\server.log
cd /d "%~dp0"
if not exist .venv\Scripts\pythonw.exe python -m uv sync
start "" .venv\Scripts\pythonw.exe -m scripts.launch
