@echo off
setlocal
cd /d "%~dp0"
echo [start.bat] Building admin UI (sessionId API, citations, phase timeline)...
call npm run admin:build
if errorlevel 1 (
  echo [start.bat] admin:build failed — fix errors above, then retry.
  exit /b 1
)
echo [start.bat] Starting backend (npm run dev)...
echo [start.bat] Admin UI: http://localhost:3000/admin
echo [start.bat] Live admin dev (optional): npm run admin:dev in another terminal
echo [start.bat] Press Ctrl+C to stop.
npm run dev
