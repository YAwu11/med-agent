@echo off
chcp 65001 >nul 2>nul
title RAGFlow Lite Shutdown

set "RAG_DIR=E:\Dev_Workspace\01_Projects\Special\med-agent\2_mcp_ragflow_lite"

echo.
echo ========================================
echo   Stopping RAGFlow Lite...
echo ========================================
echo.

echo [1/3] Stopping RAGFlow API by window title...
taskkill /FI "WINDOWTITLE eq RAGFlow-API*" /T /F >nul 2>nul

echo [2/3] Killing any Python processes on port 9380...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":9380" ^| findstr "LISTENING"') do (
    echo       Killing PID %%a ...
    taskkill /PID %%a /T /F >nul 2>nul
)

echo [3/3] Stopping Elasticsearch (Docker)...
cd /d "%RAG_DIR%"
docker-compose down

echo.
echo ========================================
echo   All RAGFlow Lite Services Stopped.
echo ========================================
echo.
pause
