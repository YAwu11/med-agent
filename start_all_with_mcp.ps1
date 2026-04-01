# start_all_with_mcp.ps1
# Script to start Gateway API and MCP Vision service together

$ScriptDir = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
$BaseDir = $ScriptDir  # Script is at repo root, no need to go up

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Starting MedAgent Services (v4) " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. Start MCP Vision Service
$McpDir = Join-Path $BaseDir "3_mcp_medical_vision\mcp_chest_xray"
Write-Host "Starting MCP Vision Service on :8002..." -ForegroundColor Green
$McpProcess = Start-Process -PassThru -WindowStyle Minimized -FilePath "python" `
    -ArgumentList "server.py" `
    -WorkingDirectory $McpDir

# 2. Wait for Health Check
Write-Host "Waiting for MCP Vision service to become ready..." -ForegroundColor Yellow
$MaxRetries = 30
$Ready = $false
for ($i = 0; $i -lt $MaxRetries; $i++) {
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:8002/health" -Method Get -TimeoutSec 2 -ErrorAction Stop
        if ($resp.status -eq "ok") {
            Write-Host "MCP Vision service is ready!" -ForegroundColor Green
            $Ready = $true
            break
        }
    } catch {
        # Ignore and retry
    }
    Start-Sleep -Seconds 2
}

if (-not $Ready) {
    Write-Host "WARNING: MCP Vision service health check failed. It might not be ready yet." -ForegroundColor Red
}

# 3. Start RAGFlow Lite Service
$RagflowDir = Join-Path $BaseDir "2_mcp_ragflow_lite"
Write-Host "Starting RAGFlow Lite Service on :9380..." -ForegroundColor Green
# Using the venv from the backend if a local one is missing, but usually this project expects its own.
# Since python is in PATH, we try to use the system python to start it if a venv is not strictly strictly required by start script,
# but to be safe we'll use the same command structure as the gateway.
$RagflowProcess = Start-Process -PassThru -WindowStyle Minimized -FilePath "python" `
    -ArgumentList "-m", "api.app" `
    -WorkingDirectory $RagflowDir

# 4. Wait for RAGFlow Health Check
Write-Host "Waiting for RAGFlow Lite service to become ready..." -ForegroundColor Yellow
$RagflowReady = $false
for ($i = 0; $i -lt $MaxRetries; $i++) {
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:9380/api/knowledge/health" -Method Get -TimeoutSec 2 -ErrorAction Stop
        if ($resp.status -eq "ok") {
            Write-Host "RAGFlow Lite service is ready!" -ForegroundColor Green
            $RagflowReady = $true
            break
        }
    } catch {
        # Ignore and retry
    }
    Start-Sleep -Seconds 2
}

if (-not $RagflowReady) {
    Write-Host "WARNING: RAGFlow Lite service health check failed." -ForegroundColor Red
}

# 5. Start Gateway Backend
$BackendDir = Join-Path $BaseDir "1_core_orchestrator\backend"
Write-Host "Starting Gateway Backend on :8001..." -ForegroundColor Green
$GatewayProcess = Start-Process -PassThru -WindowStyle Normal -FilePath "$BackendDir\.venv\Scripts\python.exe" `
    -ArgumentList "-m", "uvicorn", "app.gateway.app:app", "--host", "0.0.0.0", "--port", "8001" `
    -WorkingDirectory $BackendDir

Write-Host "Services started." -ForegroundColor Cyan
Write-Host "To stop them, you can use stop_all.ps1 or close the windows." -ForegroundColor Cyan
