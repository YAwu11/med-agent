@echo off
chcp 65001 >nul 2>nul
title RAGFlow Lite Startup

set "RAG_DIR=E:\Dev_Workspace\01_Projects\Special\med-agent\2_mcp_ragflow_lite"

echo.
echo ========================================
echo   RAGFlow Lite Starting...
echo ========================================
echo.

echo [0/2] Killing leftover processes on port 9380...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":9380" ^| findstr "LISTENING"') do (
    echo       Killing PID %%a ...
    taskkill /PID %%a /T /F >nul 2>nul
)
timeout /t 1 /nobreak >nul

echo [1/2] Starting Elasticsearch (Docker)...
cd /d "%RAG_DIR%"
docker-compose up -d
timeout /t 5 /nobreak >nul

echo [2/2] Starting RAGFlow API Service :9380...
start "RAGFlow-API" cmd /k "cd /d "%RAG_DIR%" && set PYTHONPATH=. && python -m api.app"
timeout /t 2 /nobreak >nul

echo.
echo ========================================
echo   RAGFlow Lite Started!
echo   API Docs: http://localhost:9380/docs
echo ========================================
echo.
pause
