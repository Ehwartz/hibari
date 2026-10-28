@echo off
rem Start backend (port 8000) and frontend (port 5173) in two windows, then open the browser.
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"

if not exist frontend\node_modules (
  echo Installing frontend dependencies...
  pushd frontend
  call npm install
  popd
)

start "hibari backend" cmd /k python -m uv run uvicorn backend.server.app:app --port 8000
start "hibari frontend" /d frontend cmd /k npm run dev

rem give both servers a moment to come up
timeout /t 5 /nobreak >nul
start "" http://localhost:5173
