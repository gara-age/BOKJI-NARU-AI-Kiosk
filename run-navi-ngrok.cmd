@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "ROOT=%~dp0"
set "CONFIG=%ROOT%.env.ngrok"
set "NGROK=%ROOT%tools\ngrok\ngrok.exe"

if not exist "%CONFIG%" (
  echo [ERROR] Missing .env.ngrok.
  echo Copy .env.ngrok.example to .env.ngrok and set NGROK_AUTHTOKEN and NGROK_DOMAIN.
  echo.
  pause
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in (`findstr /r /v "^[ ]*# ^[ ]*$" "%CONFIG%"`) do (
  set "%%A=%%B"
)

if "%NGROK_AUTHTOKEN%"=="" goto :missing_config
if "%NGROK_DOMAIN%"=="" goto :missing_config

rem Accept a pasted public URL, but pass ngrok only the hostname.
set "NGROK_DOMAIN=%NGROK_DOMAIN:https://=%"
set "NGROK_DOMAIN=%NGROK_DOMAIN:http://=%"
for /f "tokens=1 delims=/" %%A in ("%NGROK_DOMAIN%") do set "NGROK_DOMAIN=%%A"

if not exist "%NGROK%" (
  echo [ERROR] The local ngrok executable is missing.
  echo Install ngrok again or restore tools\ngrok\ngrok.exe.
  echo.
  pause
  exit /b 1
)

echo Configuring ngrok authentication...
"%NGROK%" config add-authtoken "%NGROK_AUTHTOKEN%" >nul
if errorlevel 1 (
  echo [ERROR] The ngrok authentication token could not be configured.
  echo Check NGROK_AUTHTOKEN in .env.ngrok.
  echo.
  pause
  exit /b 1
)

set "MUSETALK_API_URL=http://127.0.0.1:8001"
set "NAVI_API_PUBLIC_URL=http://127.0.0.1:8000"

echo Starting Navi with the public address: https://%NGROK_DOMAIN%
start "Navi MuseTalk Adapter" /D "%ROOT%" cmd /k musetalk_adapter\run-adapter.cmd
start "Navi Backend" /D "%ROOT%backend" cmd /k "set MUSETALK_API_URL=%MUSETALK_API_URL% && set NAVI_API_PUBLIC_URL=%NAVI_API_PUBLIC_URL% && .venv-py310\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
start "Navi Kiosk" /D "%ROOT%frontend" cmd /k "set NAVI_PUBLIC_HOST=%NGROK_DOMAIN% && npm run dev -- --host 127.0.0.1 --force"
timeout /t 5 /nobreak >nul
start "Navi Public Tunnel" /D "%ROOT%" cmd /k ""%NGROK%" http --url=https://%NGROK_DOMAIN% 127.0.0.1:5173"

echo.
echo Public kiosk: https://%NGROK_DOMAIN%
echo Only the kiosk is public. The API remains behind the local Vite proxy.
echo Leave the Navi and ngrok windows running while sharing this address.
echo.
pause
exit /b 0

:missing_config
echo [ERROR] NGROK_AUTHTOKEN and NGROK_DOMAIN are both required in .env.ngrok.
echo.
pause
exit /b 1
