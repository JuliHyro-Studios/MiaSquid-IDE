
@echo off
setlocal EnableExtensions
title MiaSquid IDE - Development

cd /d "%~dp0"

echo ========================================
echo       MiaSquid IDE - Starting...
echo ========================================
echo.

REM Check Node.js
where node.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH.
    echo Install Node.js or add its installation directory to PATH.
    goto :error
)

REM Check npm.cmd
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm.cmd was not found in PATH.
    echo Install Node.js with npm or add its installation directory to PATH.
    goto :error
)

REM Check package.json
if not exist "%~dp0package.json" (
    echo [ERROR] package.json was not found.
    echo Expected location: "%~dp0package.json"
    goto :error
)

REM Check whether npm can run
call npm.cmd --version
if errorlevel 1 (
    echo [ERROR] npm failed to start.
    goto :error
)

REM Check whether the start script exists
call npm.cmd run
if errorlevel 1 (
    echo [ERROR] Failed to read npm scripts.
    goto :error
)

echo.
echo [INFO] Starting MiaSquid IDE...
echo.

call npm.cmd run start
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] MiaSquid IDE exited with code %EXIT_CODE%.
    goto :error
)

echo.
echo [INFO] MiaSquid IDE exited successfully.
goto :end

:error
echo.
echo ========================================
echo             STARTUP FAILED
echo ========================================
pause
exit /b 1

:end
endlocal
exit /b 0
