@echo off
setlocal
set "ROOT=%~dp0"
set "MUSETALK_API_URL=http://127.0.0.1:8001"
set "NAVI_API_PUBLIC_URL=http://127.0.0.1:8000"

echo Starting Navi local demo in three windows...
start "Navi MuseTalk Adapter" /D "%ROOT%" cmd /k musetalk_adapter\run-adapter.cmd
start "Navi Backend" /D "%ROOT%backend" cmd /k "set MUSETALK_API_URL=%MUSETALK_API_URL% && set NAVI_API_PUBLIC_URL=%NAVI_API_PUBLIC_URL% && .venv-py310\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
start "Navi Kiosk" /D "%ROOT%frontend" cmd /k "npm run dev -- --host 127.0.0.1"
echo Kiosk: http://127.0.0.1:5173
echo API: http://127.0.0.1:8000/docs
echo MuseTalk adapter: http://127.0.0.1:8001/health
pause
