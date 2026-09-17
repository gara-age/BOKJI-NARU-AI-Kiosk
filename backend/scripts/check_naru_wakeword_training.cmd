@echo off
title Navi WakeWord Training Status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0check_naru_wakeword_training.ps1"
echo.
pause
