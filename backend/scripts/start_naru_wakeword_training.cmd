@echo off
title Navi WakeWord Training - naruya
echo ==============================================================
echo  Navi naruya WakeWord training launcher
echo  Korean status messages are rendered by PowerShell.
echo  Log: D:\NaviWakeWord\logs\naruya-training.log
echo ==============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_naru_wakeword_training.ps1"
set RESULT=%ERRORLEVEL%
echo.
echo Exit code: %RESULT%
echo Copy the output above or the log file if an error occurs.
pause
exit /b %RESULT%
