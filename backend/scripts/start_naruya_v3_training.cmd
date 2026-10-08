@echo off
chcp 65001 >nul
title Navi WakeWord Candidate Training - naruya_v3
echo Candidate training keeps the active naruya.onnx unchanged.
echo Log: D:\NaviWakeWord\logs\naruya_v3-training.log
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_naruya_v3_training.ps1"
echo.
echo Training finished or failed. Review the log above before closing this window.
pause
