@echo off
setlocal
title Navi MuseTalk Adapter
echo Adapter: http://127.0.0.1:8001
echo Stop with Ctrl+C. This window remains open afterwards.
"D:\MuseTalk\.official-cpython310-cuda118-venv\Scripts\python.exe" -m uvicorn musetalk_adapter.app:app --app-dir "C:\Users\USER\Documents\ChatGPT\복지나루" --host 127.0.0.1 --port 8001
pause
