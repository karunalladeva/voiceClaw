@echo off
setlocal
cd /d "%~dp0"
echo [start.bat] Starting backend (npm run dev)...
echo [start.bat] Admin UI: http://localhost:3000/admin
echo [start.bat] Press Ctrl+C to stop.
npm run dev
