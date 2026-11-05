@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instala Node.js 20 o posterior antes de continuar.
  pause
  exit /b 1
)
if not exist node_modules\playwright (
  call npm install
  if errorlevel 1 (
    echo No se han podido instalar las dependencias.
    pause
    exit /b 1
  )
)
set VISUALTIME_OPEN=1
call npm start
if errorlevel 1 pause
