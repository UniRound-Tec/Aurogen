@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: ============================================================
::  Aurogen Windows 整合包构建脚本
::  用法：在项目根目录执行  build\build-windows.bat
::  产物：dist\aurogen-VERSION-windows-x64.zip
::  需要：Windows 10+（自带 curl 和 tar）
:: ============================================================

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "RUNTIME=%ROOT%\runtime"
set "DOWNLOADS=%ROOT%\build\downloads"
set "PYTHON_DIR=%RUNTIME%\python"
set "NODE_DIR=%RUNTIME%\node"

set "PYTHON_VERSION=3.11.15"
set "PYTHON_TAG=20260303"
set "NODE_VERSION=22.14.0"

set "PY_ARCH=x86_64-pc-windows-msvc"
set "NODE_ARCH=win-x64"

set "PY_FILENAME=cpython-%PYTHON_VERSION%+%PYTHON_TAG%-%PY_ARCH%-install_only.tar.gz"
set "PY_URL=https://github.com/astral-sh/python-build-standalone/releases/download/%PYTHON_TAG%/%PY_FILENAME%"

set "NODE_FILENAME=node-v%NODE_VERSION%-%NODE_ARCH%.zip"
set "NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/%NODE_FILENAME%"

if not exist "%RUNTIME%" mkdir "%RUNTIME%"
if not exist "%DOWNLOADS%" mkdir "%DOWNLOADS%"

:: ── Step 1: Python ──────────────────────────────────────────
echo [build] ========== [1/5] 准备 Python 运行时 ==========

if exist "%DOWNLOADS%\%PY_FILENAME%" (
    echo [build] 已缓存，跳过下载: %PY_FILENAME%
) else (
    echo [build] 下载: %PY_FILENAME%
    curl -L --progress-bar "%PY_URL%" -o "%DOWNLOADS%\%PY_FILENAME%"
    if errorlevel 1 (
        echo [error] Python 下载失败
        goto :fail
    )
)

if exist "%PYTHON_DIR%" (
    echo [warn]  已存在 runtime\python\，清除重建...
    rmdir /s /q "%PYTHON_DIR%"
)

echo [build] 解压 Python...
tar -xzf "%DOWNLOADS%\%PY_FILENAME%" -C "%RUNTIME%"

if not exist "%PYTHON_DIR%\python.exe" (
    echo [error] Python 解压异常，未找到 python.exe
    goto :fail
)
"%PYTHON_DIR%\python.exe" --version
echo [build] Python 就绪

:: ── Step 2: pip install ─────────────────────────────────────
echo [build] ========== [2/5] 安装 Python 依赖 ==========

"%PYTHON_DIR%\python.exe" -m pip install --upgrade pip -q
if errorlevel 1 (
    echo [error] pip 升级失败
    goto :fail
)

"%PYTHON_DIR%\python.exe" -m pip install -r "%ROOT%\aurogen\requirements.txt" -q
if errorlevel 1 (
    echo [error] Python 依赖安装失败
    goto :fail
)
echo [build] Python 依赖安装完成

:: ── Step 3: Node.js ─────────────────────────────────────────
echo [build] ========== [3/5] 准备 Node.js 运行时 ==========

if exist "%DOWNLOADS%\%NODE_FILENAME%" (
    echo [build] 已缓存，跳过下载: %NODE_FILENAME%
) else (
    echo [build] 下载: %NODE_FILENAME%
    curl -L --progress-bar "%NODE_URL%" -o "%DOWNLOADS%\%NODE_FILENAME%"
    if errorlevel 1 (
        echo [error] Node.js 下载失败
        goto :fail
    )
)

if exist "%NODE_DIR%" (
    echo [warn]  已存在 runtime\node\，清除重建...
    rmdir /s /q "%NODE_DIR%"
)

echo [build] 解压 Node.js...
set "TMP_NODE=%DOWNLOADS%\.node_tmp_win"
if exist "%TMP_NODE%" rmdir /s /q "%TMP_NODE%"
mkdir "%TMP_NODE%"

:: Node.js Windows 版是 .zip 格式，用 tar 或 PowerShell 解压
tar -xf "%DOWNLOADS%\%NODE_FILENAME%" -C "%TMP_NODE%" 2>nul
if errorlevel 1 (
    echo [build] tar 解压失败，尝试 PowerShell...
    powershell -NoProfile -Command "Expand-Archive -Path '%DOWNLOADS%\%NODE_FILENAME%' -DestinationPath '%TMP_NODE%' -Force"
    if errorlevel 1 (
        echo [error] Node.js 解压失败
        goto :fail
    )
)

:: 移动解压后的子目录到目标路径
for /d %%D in ("%TMP_NODE%\node-v*") do (
    move "%%D" "%NODE_DIR%" >nul
)
rmdir /s /q "%TMP_NODE%" 2>nul

if not exist "%NODE_DIR%\node.exe" (
    echo [error] Node.js 解压异常，未找到 node.exe
    goto :fail
)
"%NODE_DIR%\node.exe" --version
echo [build] Node.js 就绪

:: ── Step 4: 构建前端 ────────────────────────────────────────
echo [build] ========== [4/5] 构建前端 (aurogen_web) ==========

set "PATH=%NODE_DIR%;%PATH%"

pushd "%ROOT%\aurogen_web"
echo [build] npm install...
call npm install
if errorlevel 1 (
    popd
    echo [error] npm install 失败
    goto :fail
)
echo [build] npm run build...
call npm run build
if errorlevel 1 (
    popd
    echo [error] npm run build 失败
    goto :fail
)
popd
echo [build] 前端构建完成

:: ── Step 5: 组装发行包 ──────────────────────────────────────
echo [build] ========== [5/5] 组装发行包 ==========

:: 读取版本号
for /f "tokens=2 delims=:" %%A in ('findstr /c:"\"version\"" "%ROOT%\aurogen_web\package.json"') do (
    set "RAW_VER=%%A"
)
set "APP_VERSION=%RAW_VER: =%"
set "APP_VERSION=%APP_VERSION:"=%"
set "APP_VERSION=%APP_VERSION:,=%"

set "PACKAGE_NAME=aurogen-%APP_VERSION%-windows-x64"
set "DIST_DIR=%ROOT%\dist"
set "PACKAGE_DIR=%DIST_DIR%\%PACKAGE_NAME%"

if exist "%PACKAGE_DIR%" rmdir /s /q "%PACKAGE_DIR%"
mkdir "%PACKAGE_DIR%"

:: 复制运行时
xcopy "%RUNTIME%" "%PACKAGE_DIR%\runtime" /e /i /q >nul

:: 复制后端代码
xcopy "%ROOT%\aurogen" "%PACKAGE_DIR%\aurogen" /e /i /q >nul
del /q "%PACKAGE_DIR%\aurogen\.workspace\config.json" 2>nul
if exist "%PACKAGE_DIR%\aurogen\.workspace\agents\main" rmdir /s /q "%PACKAGE_DIR%\aurogen\.workspace\agents\main"
del /q "%PACKAGE_DIR%\aurogen\.workspace\cron\jobs.json" 2>nul

:: 复制前端构建产物
mkdir "%PACKAGE_DIR%\aurogen_web" 2>nul
xcopy "%ROOT%\aurogen_web\dist" "%PACKAGE_DIR%\aurogen_web\dist" /e /i /q >nul

:: 清理缓存和日志
for /d /r "%PACKAGE_DIR%\aurogen" %%D in (__pycache__) do (
    if exist "%%D" rmdir /s /q "%%D"
)
del /s /q "%PACKAGE_DIR%\aurogen\*.pyc" 2>nul
del /s /q "%PACKAGE_DIR%\aurogen\*.log" 2>nul

:: 生成 start.bat
(
echo @echo off
echo setlocal
echo chcp 65001 ^>nul 2^>^&1
echo.
echo set "ROOT=%%~dp0"
echo set "ROOT=%%ROOT:~0,-1%%"
echo set "PYTHON=%%ROOT%%\runtime\python\python.exe"
echo set "NODE=%%ROOT%%\runtime\node\node.exe"
echo.
echo if not exist "%%PYTHON%%" ^(
echo     echo [error] 运行时不完整，请重新下载整合包
echo     pause
echo     exit /b 1
echo ^)
echo if not exist "%%NODE%%" ^(
echo     echo [error] Node.js 运行时不完整，请重新下载整合包
echo     pause
echo     exit /b 1
echo ^)
echo.
echo set "PATH=%%ROOT%%\runtime\python;%%ROOT%%\runtime\python\Scripts;%%ROOT%%\runtime\node;%%PATH%%"
echo.
echo echo [aurogen] 启动 Aurogen...
echo for /f "tokens=*" %%%%v in ^('"%%PYTHON%%" --version'^) do echo [aurogen] Python: %%%%v
echo for /f "tokens=*" %%%%v in ^('"%%NODE%%" --version'^) do echo [aurogen] Node:   %%%%v
echo.
echo echo.
echo echo =====================================================
echo echo   Aurogen 正在启动...
echo echo   请在浏览器中访问: http://localhost:8000
echo echo =====================================================
echo echo.
echo.
echo cd /d "%%ROOT%%\aurogen"
echo "%%PYTHON%%" -m uvicorn app.app:app --host 0.0.0.0 --port 8000
echo.
echo pause
) > "%PACKAGE_DIR%\start.bat"

:: 打包成 zip
echo [build] 打包中...
if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"

pushd "%DIST_DIR%"
powershell -NoProfile -Command "Compress-Archive -Path '%PACKAGE_NAME%' -DestinationPath '%PACKAGE_NAME%.zip' -Force"
if errorlevel 1 (
    popd
    echo [error] zip 打包失败
    goto :fail
)
popd

rmdir /s /q "%PACKAGE_DIR%"

echo.
echo =====================================================
echo   构建完成！
echo   产物: dist\%PACKAGE_NAME%.zip
echo =====================================================

endlocal
exit /b 0

:fail
echo.
echo =====================================================
echo   构建失败，请检查上方日志
echo =====================================================
pause

endlocal
exit /b 1