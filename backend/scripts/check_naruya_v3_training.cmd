@echo off
chcp 65001 >nul
setlocal
title Naru Wake-word Candidate Training Status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0check_naruya_v3_training.ps1"
echo.
pause
