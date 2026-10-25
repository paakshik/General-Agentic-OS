@echo off
setlocal EnableExtensions
rem Meridian OS single-click launcher. Starts the local server only if it is
rem not already running, waits for a healthy /api/health, then opens the browser.
rem Optional flags: --no-open (health-check start without opening the browser)

set "ROOT=%~dp0.."
set "PORT=4780"
set "NOOPEN="
if /i "%~1"=="--no-open" set "NOOPEN=1"

where node >nul 2>nul
if errorlevel 1 (
  echo [Meridian OS] Node.js was not found on PATH. Install Node.js 18+ and try again.
  if not defined NOOPEN pause
  exit /b 1
)

powershell -NoProfile -Command "try{ $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:%PORT%/api/health'; if($r.StatusCode -eq 200){exit 0} }catch{ exit 1 }"
if not errorlevel 1 (
  echo [Meridian OS] Already running at http://127.0.0.1:%PORT% - opening it.
  if not defined NOOPEN start "" "http://127.0.0.1:%PORT%"
  exit /b 0
)

if not exist "%ROOT%\data" mkdir "%ROOT%\data"
start "Meridian OS server" /min cmd /c "node ""%ROOT%\server\server.js"" --port %PORT%"

set /a TRIES=0
:waitloop
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try{ $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:%PORT%/api/health'; if($r.StatusCode -eq 200){exit 0} }catch{ exit 1 }"
if not errorlevel 1 goto opened
set /a TRIES+=1
if %TRIES% lss 20 goto waitloop

echo [Meridian OS] Startup failed after 20 seconds. See the log:
echo   %ROOT%\data\logs\server.log
if not defined NOOPEN pause
exit /b 1

:opened
echo [Meridian OS] Running at http://127.0.0.1:%PORT%
if not defined NOOPEN start "" "http://127.0.0.1:%PORT%"
exit /b 0
