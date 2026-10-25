@echo off
setlocal
rem Graceful Meridian OS shutdown: asks the server to stop itself.
rem If nothing is running, this reports it and changes nothing.
powershell -NoProfile -Command "try{ Invoke-RestMethod -Method Post -TimeoutSec 5 'http://127.0.0.1:4780/api/shutdown?confirm=true' | Out-Null; Write-Output '[Meridian OS] Server stopped.' }catch{ Write-Output '[Meridian OS] No running instance found (or it refused shutdown).' }"
