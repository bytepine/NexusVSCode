@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

echo ============================================
echo   NexusMCP VSCode Extension - Beta Build
echo ============================================
echo.

cd /d "%~dp0"

:: ── 1. 读取当前版本 ──────────────────────────────────────
set /p CURRENT_VERSION=<VERSION
set CURRENT_VERSION=%CURRENT_VERSION: =%
echo Current VERSION : %CURRENT_VERSION%

:: 解析 major.minor.patch（strip 可能的 -beta/-rc 后缀）
for /f "tokens=1,2,3 delims=." %%a in ("%CURRENT_VERSION%") do (
    set MAJOR=%%a
    set MINOR=%%b
    set PATCH=%%c
)
for /f "tokens=1 delims=-" %%x in ("%PATCH%") do set PATCH=%%x

set /a NEXT_PATCH=%PATCH%+1
set NEXT_VERSION=%MAJOR%.%MINOR%.%NEXT_PATCH%-beta

echo Next beta version: %NEXT_VERSION%
echo.

:: ── 2. 调用 Python 打包脚本 ──────────────────────────────
echo [1/2] Building extension (version: %NEXT_VERSION%)...
python scripts\build_vscode.py --version %NEXT_VERSION%
if %ERRORLEVEL% neq 0 (
    echo.
    echo [FAILED] Build failed! See output above for details.
    pause
    exit /b 1
)

:: ── 3. 显示产物路径 ──────────────────────────────────────
echo.
echo [2/2] Build successful!
echo.
for %%f in (release\nexus-mcp-vscode-%NEXT_VERSION%.vsix) do (
    echo Output: %cd%\%%f
)
echo.
echo Install: Extensions sidebar → ... → Install from VSIX...
echo.
pause
