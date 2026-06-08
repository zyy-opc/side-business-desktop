@echo off
REM ============================================================================
REM side-business-desktop 构建脚本
REM 产出: build/side-business-installer-1.0.0.exe
REM 依赖: Node.js 18+, npm, pkg (npx), makensis (可选)
REM ============================================================================

setlocal enabledelayedexpansion

set VERSION=1.0.0
set PROJECT_DIR=%~dp0..
set BUILD_DIR=%PROJECT_DIR%\build
set PAYLOAD_DIR=%BUILD_DIR%\payload
set SERVER_DIR=%PROJECT_DIR%\server
set CLIENT_DIR=%PROJECT_DIR%\..\side-business-system\client

echo ============================================
echo 侧方运营管理系统 — 构建脚本
echo 版本: %VERSION%
echo ============================================

REM --- 步骤 0: 创建目录 ---
echo [0/5] 准备构建目录...
if not exist "%PAYLOAD_DIR%" mkdir "%PAYLOAD_DIR%"
if not exist "%PAYLOAD_DIR%\tessdata" mkdir "%PAYLOAD_DIR%\tessdata"
if not exist "%PAYLOAD_DIR%\fonts" mkdir "%PAYLOAD_DIR%\fonts"

REM --- 步骤 1: 构建前端 ---
echo [1/5] 构建前端...
cd /d "%CLIENT_DIR%"
call npx vite build
if %ERRORLEVEL% NEQ 0 (
    echo 错误: 前端构建失败!
    exit /b 1
)

REM --- 步骤 2: 复制前端产物 ---
echo [2/5] 复制前端产物到服务器目录...
if exist "%SERVER_DIR%\client-dist" rmdir /s /q "%SERVER_DIR%\client-dist"
xcopy /e /i /q "%CLIENT_DIR%\dist" "%SERVER_DIR%\client-dist"
if %ERRORLEVEL% NEQ 0 (
    echo 错误: 前端复制失败!
    exit /b 1
)

REM --- 步骤 3: 安装 server 依赖并编译 ---
echo [3/5] 安装后端依赖并编译 TypeScript...
cd /d "%SERVER_DIR%"
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo 错误: npm install 失败!
    exit /b 1
)
call npx tsc
if %ERRORLEVEL% NEQ 0 (
    echo 警告: TypeScript 编译有错误，但继续打包...
)

REM --- 步骤 4: pkg 打包 ---
echo [4/5] pkg 打包为 EXE...
cd /d "%SERVER_DIR%"
call npx pkg . --targets node18-win-x64 --output "%PAYLOAD_DIR%\side-business.exe"
if %ERRORLEVEL% NEQ 0 (
    echo 错误: pkg 打包失败!
    exit /b 1
)

REM --- 步骤 5: 复制资源文件到 payload ---
echo [5/5] 复制资源文件...
if exist "%SERVER_DIR%\tessdata\chi_sim.traineddata" (
    copy /y "%SERVER_DIR%\tessdata\chi_sim.traineddata" "%PAYLOAD_DIR%\tessdata\" >nul
) else (
    echo 警告: chi_sim.traineddata 未找到，OCR 中文识别将不可用
    echo 请从 https://github.com/tesseract-ocr/tessdata/raw/main/chi_sim.traineddata 下载
)

REM --- 可选: makensis 编译安装包 ---
where makensis >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo 编译 NSIS 安装包...
    cd /d "%BUILD_DIR%\installer"
    makensis installer.nsi
    if %ERRORLEVEL% EQU 0 (
        echo 安装包已生成: %BUILD_DIR%\side-business-installer-%VERSION%.exe
    ) else (
        echo 警告: NSIS 编译失败
    )
) else (
    echo 信息: makensis 未安装，跳过安装包编译
    echo EXE 文件已生成: %PAYLOAD_DIR%\side-business.exe
)

echo ============================================
echo 构建完成!
echo ============================================
endlocal
