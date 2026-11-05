@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 20 or later before continuing.
  pause
  exit /b 1
)
if not exist node_modules\playwright (
  call npm install
  if errorlevel 1 (
    echo Unable to install dependencies.
    pause
    exit /b 1
  )
)
set VISUALTIME_OPEN=1
call npm start
if errorlevel 1 pause
