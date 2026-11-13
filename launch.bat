@echo off
cd /d "%~dp0"
start "" /B node server.js --auto-exit
timeout /t 1 /nobreak >nul

set "EDGE_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE_PATH%" set "EDGE_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE_PATH%" set "EDGE_PATH=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"

if exist "%EDGE_PATH%" (
  start "" "%EDGE_PATH%" --app=http://127.0.0.1:4173 --window-size=1360,840
) else (
  start "" "http://127.0.0.1:4173"
)
