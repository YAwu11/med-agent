@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>nul
title MedAgent 综合服务控制台

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "ORCH_DIR=%ROOT%\1_core_orchestrator"
set "BACKEND=%ORCH_DIR%\backend"
set "FRONTEND=%ORCH_DIR%\frontend"
set "NGINX_DIR=%ORCH_DIR%\docker\nginx"
set "NGINX_EXE=%NGINX_DIR%\nginx.exe"

set "RAG_DIR=%ROOT%\2_mcp_ragflow_lite"
set "MCP_VISION=%ROOT%\3_mcp_medical_vision\mcp_chest_xray"
set "MCP_SERVER=%MCP_VISION%\server.py"

set "BACKEND_PYTHON=%BACKEND%\.venv\Scripts\python.exe"
set "RAG_PYTHON=%RAG_DIR%\.venv\Scripts\python.exe"
set "VISION_PYTHON=%MCP_VISION%\.venv\Scripts\python.exe"
if not exist "%VISION_PYTHON%" set "VISION_PYTHON=%BACKEND_PYTHON%"

set "DOCKER_COMPOSE_CMD="
call :RESOLVE_DOCKER_COMPOSE >nul 2>nul

:MENU
cls
echo ========================================
echo       MedAgent 综合服务控制台
echo ========================================
echo.
echo   [1] 一键启动全部服务
echo   [2] 一键关闭全部服务
echo.
echo   [3] 启动 MedAgent 主系统
echo   [4] 启动 RAGFlow Lite
echo   [5] 关闭 MedAgent 主系统
echo   [6] 关闭 RAGFlow Lite
echo.
echo   [7] 环境检查与安装说明
echo   [0] 退出控制台
echo.
echo 说明:
echo   - 不依赖 make / Git Bash
echo   - 主系统直接使用项目内 .venv 启动
echo   - RAG 依赖 Docker Desktop
echo.
set /p choice="请选择操作 (0-7): "

if "%choice%"=="1" goto START_ALL
if "%choice%"=="2" goto STOP_ALL
if "%choice%"=="3" goto START_MED
if "%choice%"=="4" goto START_RAG
if "%choice%"=="5" goto STOP_MED
if "%choice%"=="6" goto STOP_RAG
if "%choice%"=="7" goto ENV_CHECK
if "%choice%"=="0" goto EOF

goto MENU


:START_ALL
cls
set "ALL_OK=1"
echo 正在启动全部服务...
call :START_RAG_PROC
if errorlevel 1 set "ALL_OK=0"
call :START_MED_PROC
if errorlevel 1 set "ALL_OK=0"
echo.
if "%ALL_OK%"=="1" (
    echo 全部服务已启动完毕。
) else (
    echo 部分服务未成功启动，请查看上方提示。
)
pause
goto MENU

:STOP_ALL
cls
echo 正在关闭全部系统...
call :STOP_RAG_PROC
call :STOP_MED_PROC
echo.
echo 所有服务已执行关闭流程。
pause
goto MENU

:START_MED
cls
call :START_MED_PROC
pause
goto MENU

:START_RAG
cls
call :START_RAG_PROC
pause
goto MENU

:STOP_MED
cls
call :STOP_MED_PROC
pause
goto MENU

:STOP_RAG
cls
call :STOP_RAG_PROC
pause
goto MENU

:ENV_CHECK
cls
call :SHOW_ENV_CHECK
pause
goto MENU


:START_MED_PROC
echo.
echo === 启动 MedAgent 主系统 ===
call :CHECK_MED_PREREQS
if errorlevel 1 exit /b 1

if exist "%MCP_SERVER%" (
    echo [1/5] 启动 MCP Vision SSE Server (Port: 8002，可选)
    start "MedAgent-MCP-Vision" cmd /k "cd /d "%MCP_VISION%" && "%VISION_PYTHON%" server.py"
    call :WAIT_FOR_PORT 8002 10 "MCP Vision"
    if errorlevel 1 echo [警告] MCP Vision 未在 10 秒内就绪，主系统仍会继续启动。
) else (
    echo [1/5] 跳过 MCP Vision：未找到 %MCP_SERVER%
)

echo [2/5] 启动 LangGraph Server (Port: 2024)
start "MedAgent-LangGraph" cmd /k "cd /d "%BACKEND%" && set NO_COLOR=1 && "%BACKEND_PYTHON%" -m langgraph_cli dev --no-browser --allow-blocking --no-reload"
call :WAIT_FOR_PORT 2024 60 "LangGraph"
if errorlevel 1 (
    echo [失败] LangGraph 未在 60 秒内启动。
    exit /b 1
)

echo [3/5] 启动 Gateway API (Port: 8001)
start "MedAgent-Gateway" cmd /k "cd /d "%BACKEND%" && set PYTHONPATH=. && "%BACKEND_PYTHON%" -m uvicorn app.gateway.app:app --host 0.0.0.0 --port 8001"
call :WAIT_FOR_PORT 8001 60 "Gateway"
if errorlevel 1 (
    echo [失败] Gateway 未在 60 秒内启动。
    exit /b 1
)

echo [4/5] 启动 Frontend (Port: 3000)
start "MedAgent-Frontend" cmd /k "cd /d "%FRONTEND%" && set SKIP_ENV_VALIDATION=1 && pnpm dev"
call :WAIT_FOR_PORT 3000 120 "Frontend"
if errorlevel 1 (
    echo [失败] Frontend 未在 120 秒内启动。
    exit /b 1
)

echo [5/5] 启动 Nginx (Port: 2026)
call :PREPARE_NGINX_DIRS
"%NGINX_EXE%" -p "%NGINX_DIR%" -c "%NGINX_DIR%\nginx.local.conf" -s stop >nul 2>nul
timeout /t 1 /nobreak >nul
start "MedAgent-Nginx" "%NGINX_EXE%" -p "%NGINX_DIR%" -c "%NGINX_DIR%\nginx.local.conf"
call :WAIT_FOR_PORT 2026 15 "Nginx"
if errorlevel 1 (
    echo [失败] Nginx 未在 15 秒内启动。
    exit /b 1
)

echo --- MedAgent 主系统启动完毕 ---
exit /b 0


:STOP_MED_PROC
echo.
echo === 关闭 MedAgent 主系统 ===
for %%p in (3000 8001 8002 2024 2026) do call :STOP_PORT %%p
for %%w in (MedAgent-MCP-Vision MedAgent-LangGraph MedAgent-Gateway MedAgent-Frontend MedAgent-Nginx) do (
    taskkill /FI "WINDOWTITLE eq %%w*" /T /F >nul 2>&1
)
taskkill /F /IM "nginx.exe" >nul 2>&1

echo [Clean] 清理 LangGraph checkpoint 缓存...
set "CHECKPOINT_DB=%BACKEND%\.deer-flow\checkpoints.db"
if exist "%CHECKPOINT_DB%" del /F /Q "%CHECKPOINT_DB%"
if exist "%CHECKPOINT_DB%-wal" del /F /Q "%CHECKPOINT_DB%-wal"
if exist "%CHECKPOINT_DB%-shm" del /F /Q "%CHECKPOINT_DB%-shm"
echo --- MedAgent 已关闭 ---
exit /b 0


:START_RAG_PROC
echo.
echo === 启动 RAGFlow Lite ===
call :CHECK_RAG_PREREQS
if errorlevel 1 exit /b 1

call :STOP_PORT 9380
taskkill /FI "WINDOWTITLE eq MedAgent-RAGFlow*" /T /F >nul 2>&1

echo [1/2] 启动 Elasticsearch (Docker)
cd /d "%RAG_DIR%"
%DOCKER_COMPOSE_CMD% up -d
if errorlevel 1 (
    echo [失败] Docker 服务启动失败。
    exit /b 1
)
timeout /t 5 /nobreak >nul

echo [2/2] 启动 RAGFlow API (Port: 9380)
start "MedAgent-RAGFlow" cmd /k "cd /d "%RAG_DIR%" && set PYTHONPATH=. && "%RAG_PYTHON%" -m api.app"
call :WAIT_FOR_PORT 9380 30 "RAGFlow API"
if errorlevel 1 (
    echo [失败] RAGFlow API 未在 30 秒内启动。
    exit /b 1
)

echo --- RAGFlow Lite 启动完毕 ---
exit /b 0


:STOP_RAG_PROC
echo.
echo === 关闭 RAGFlow Lite ===
taskkill /FI "WINDOWTITLE eq MedAgent-RAGFlow*" /T /F >nul 2>&1
call :STOP_PORT 9380
if defined DOCKER_COMPOSE_CMD (
    echo [Down] 关闭 Elasticsearch (Docker)
    cd /d "%RAG_DIR%"
    %DOCKER_COMPOSE_CMD% down
)
echo --- RAGFlow Lite 已关闭 ---
exit /b 0


:SHOW_ENV_CHECK
echo ========================================
echo 环境检查与安装说明
echo ========================================
echo.
echo [当前状态]
if exist "%BACKEND_PYTHON%" (echo   [OK] backend .venv 已存在) else echo   [缺失] backend .venv 不存在
if exist "%RAG_PYTHON%" (echo   [OK] RAG .venv 已存在) else echo   [缺失] RAG .venv 不存在
if exist "%FRONTEND%\node_modules" (echo   [OK] frontend node_modules 已存在) else echo   [缺失] frontend node_modules 不存在
call :CHECK_COMMAND pnpm
if errorlevel 1 (echo   [缺失] pnpm 未安装) else echo   [OK] pnpm 已安装
call :CHECK_COMMAND docker
if errorlevel 1 (echo   [缺失] Docker Desktop 未安装) else echo   [OK] Docker 命令可用
if defined DOCKER_COMPOSE_CMD (echo   [OK] Docker Compose 可用: %DOCKER_COMPOSE_CMD%) else echo   [缺失] Docker Compose 不可用
if exist "%NGINX_EXE%" (echo   [OK] nginx.exe 已找到) else echo   [缺失] nginx.exe 未找到
if exist "%MCP_SERVER%" (echo   [可选] MCP Vision 服务脚本已找到) else echo   [可选] MCP Vision 服务脚本未找到
echo.
echo [你需要安装 / 准备的东西]
echo   1. Node.js LTS + pnpm（前端需要）
echo   2. Docker Desktop（RAG + Elasticsearch 需要）
echo   3. backend 和 RAG 的本地虚拟环境
echo.
echo [初始化命令]
echo   backend:  cd /d "%BACKEND%" ^&^& uv sync
echo   frontend: cd /d "%FRONTEND%" ^&^& pnpm install
echo   rag:      cd /d "%RAG_DIR%" ^&^& python -m venv .venv
echo             "%RAG_DIR%\.venv\Scripts\python.exe" -m pip install -r requirements.txt
echo.
echo [不需要再装的东西]
echo   - make
echo   - Git Bash
echo.
exit /b 0


:CHECK_MED_PREREQS
if not exist "%BACKEND_PYTHON%" (
    echo [缺失] backend .venv 未初始化: %BACKEND_PYTHON%
    echo        请执行: cd /d "%BACKEND%" ^&^& uv sync
    exit /b 1
)
if not exist "%FRONTEND%\node_modules" (
    echo [缺失] frontend 依赖未安装: %FRONTEND%\node_modules
    echo        请执行: cd /d "%FRONTEND%" ^&^& pnpm install
    exit /b 1
)
call :CHECK_COMMAND pnpm
if errorlevel 1 (
    echo [缺失] pnpm 未安装或未加入 PATH
    echo        请先安装 Node.js LTS，然后执行: npm install -g pnpm
    exit /b 1
)
if not exist "%NGINX_EXE%" (
    echo [缺失] nginx.exe 未找到: %NGINX_EXE%
    exit /b 1
)
exit /b 0


:CHECK_RAG_PREREQS
if not exist "%RAG_PYTHON%" (
    echo [缺失] RAG .venv 未初始化: %RAG_PYTHON%
    echo        请执行: cd /d "%RAG_DIR%" ^&^& python -m venv .venv
    echo        然后执行: "%RAG_DIR%\.venv\Scripts\python.exe" -m pip install -r requirements.txt
    exit /b 1
)
call :CHECK_COMMAND docker
if errorlevel 1 (
    echo [缺失] Docker Desktop 未安装或未加入 PATH
    exit /b 1
)
call :RESOLVE_DOCKER_COMPOSE
if errorlevel 1 (
    echo [缺失] Docker Compose 不可用，请安装或更新 Docker Desktop
    exit /b 1
)
docker info >nul 2>&1
if errorlevel 1 (
    echo [缺失] Docker Desktop 未启动，请先打开 Docker Desktop
    exit /b 1
)
exit /b 0


:CHECK_COMMAND
where %~1 >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 0


:RESOLVE_DOCKER_COMPOSE
set "DOCKER_COMPOSE_CMD="
docker compose version >nul 2>&1
if not errorlevel 1 set "DOCKER_COMPOSE_CMD=docker compose"
if not defined DOCKER_COMPOSE_CMD (
    docker-compose version >nul 2>&1
    if not errorlevel 1 set "DOCKER_COMPOSE_CMD=docker-compose"
)
if defined DOCKER_COMPOSE_CMD exit /b 0
exit /b 1


:PREPARE_NGINX_DIRS
for %%d in (logs temp proxy_temp fastcgi_temp uwsgi_temp scgi_temp client_body_temp) do (
    if not exist "%NGINX_DIR%\%%d" mkdir "%NGINX_DIR%\%%d"
)
exit /b 0


:WAIT_FOR_PORT
set "WAIT_PORT=%~1"
set "WAIT_SECONDS=%~2"
set "WAIT_NAME=%~3"
set /a WAIT_ELAPSED=0

:WAIT_FOR_PORT_LOOP
netstat -ano | findstr ":!WAIT_PORT! " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 exit /b 0
if !WAIT_ELAPSED! GEQ !WAIT_SECONDS! exit /b 1
timeout /t 1 /nobreak >nul
set /a WAIT_ELAPSED+=1
goto WAIT_FOR_PORT_LOOP


:STOP_PORT
set "STOP_PORT_VALUE=%~1"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":!STOP_PORT_VALUE! " ^| findstr "LISTENING"') do (
    echo   [Kill] 端口 !STOP_PORT_VALUE! 释放 (PID: %%a)
    taskkill /F /PID %%a >nul 2>&1
)
exit /b 0


:EOF
endlocal
exit /b 0
