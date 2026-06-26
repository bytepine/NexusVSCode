@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

echo ============================================
echo   NexusMCP VSCode Extension - Build
echo ============================================
echo.

cd /d "%~dp0"

:: ── 1. 读取当前版本 ──────────────────────────────────────
set /p VERSION=<VERSION
set VERSION=%VERSION: =%
echo Version: %VERSION%
echo.

:: ── 2. 调用 Python 打包脚本（产物自动输出到 release/）────
echo [1/2] Building extension (version: %VERSION%)...
python scripts\build_vscode.py --version %VERSION%
if %ERRORLEVEL% neq 0 (
    echo.
    echo [FAILED] Build failed! See output above for details.
    pause
    exit /b 1
)

echo.
echo [2/2] Build successful!
echo.
echo Output: %cd%\release\nexus-mcp-vscode-%VERSION%.vsix
echo.
echo Install: Extensions sidebar → ... → Install from VSIX...
echo.
pause
