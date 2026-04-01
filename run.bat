@echo off
setlocal enabledelayedexpansion

REM Default args
set "CLI_ARGS=--version"
if not "%~1"=="" set "CLI_ARGS=%*"

set "LOCAL_NODE_DIR=%~dp0.tools\node\current"
set "NODE_CMD=node"
set "NPM_CMD=npm"

echo [STEP] Checking Node.js and npm
where node >nul 2>nul
if errorlevel 1 (
  if exist "%LOCAL_NODE_DIR%\node.exe" (
    set "NODE_CMD=%LOCAL_NODE_DIR%\node.exe"
    set "NPM_CMD=%LOCAL_NODE_DIR%\npm.cmd"
    set "PATH=%LOCAL_NODE_DIR%;%PATH%"
    echo [INFO] Using local portable Node runtime at %LOCAL_NODE_DIR%
  ) else (
    echo [INFO] Node.js not found in PATH. Bootstrapping portable Node.js runtime...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap-node.ps1"
    if errorlevel 1 (
      echo [ERROR] Automatic Node bootstrap failed. Install Node.js 18+ ^(recommended 20 LTS^) manually, then rerun.
      exit /b 1
    )
    if exist "%LOCAL_NODE_DIR%\node.exe" (
      set "NODE_CMD=%LOCAL_NODE_DIR%\node.exe"
      set "NPM_CMD=%LOCAL_NODE_DIR%\npm.cmd"
      set "PATH=%LOCAL_NODE_DIR%;%PATH%"
      echo [INFO] Using bootstrapped Node runtime at %LOCAL_NODE_DIR%
    ) else (
      echo [ERROR] Bootstrap reported success, but local node.exe was not found.
      exit /b 1
    )
  )
)

where npm >nul 2>nul
if errorlevel 1 (
  if not exist "%LOCAL_NODE_DIR%\npm.cmd" (
    echo [ERROR] npm is not available in PATH and local npm was not found.
    exit /b 1
  )
)

echo Node:
call "%NODE_CMD%" -v
if errorlevel 1 (
  echo [ERROR] Failed to read Node.js version
  exit /b 1
)

echo npm:
call "%NPM_CMD%" -v
if errorlevel 1 (
  echo [ERROR] Failed to read npm version
  exit /b 1
)

echo [STEP] Installing dependencies
call "%NPM_CMD%" install
if errorlevel 1 (
  echo [ERROR] npm install failed
  exit /b 1
)

echo [STEP] Building project
call "%NPM_CMD%" run build
if errorlevel 1 (
  echo [ERROR] npm run build failed
  exit /b 1
)

if not exist "dist\cli.js" (
  echo [ERROR] Build completed but dist\cli.js not found
  exit /b 1
)

echo [STEP] Running CLI
call "%NODE_CMD%" dist\cli.js %CLI_ARGS%
if errorlevel 1 (
  echo [ERROR] CLI execution failed
  exit /b 1
)

echo [DONE] Completed successfully
exit /b 0
