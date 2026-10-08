@echo off
chcp 65001 >nul
setlocal
title Navi Public Data Benchmark
cd /d "%~dp0backend"
.venv-py310\Scripts\python.exe scripts\benchmark_public_data.py
echo.
echo The report is saved under backend\runtime\benchmarks.
pause
