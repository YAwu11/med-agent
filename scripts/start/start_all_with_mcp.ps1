# start_all_with_mcp.ps1
# Windows helper to start MedAgent backend-adjacent services together.
# Starts: LangGraph (2024), Gateway (8001), chest MCP (8002), brain MCP (8003), RAGFlow Lite (9380).

$ScriptDir = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
$BaseDir = Split-Path -Parent (Split-Path -Parent $ScriptDir)

$BackendDir = Join-Path $BaseDir "1_core_orchestrator\backend"
$BackendPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
$LangGraphConfig = Join-Path $BackendDir "langgraph.json"

$RagflowDir = Join-Path $BaseDir "2_mcp_ragflow_lite"
$RagflowPython = Join-Path $RagflowDir ".venv\Scripts\python.exe"
$RagflowPythonToUse = if (Test-Path $RagflowPython) { $RagflowPython } else { "python" }

$ChestDir = Join-Path $BaseDir "3_mcp_medical_vision\mcp_chest_xray"
$BrainDir = Join-Path $BaseDir "3_mcp_medical_vision\brain_tumor_pipeline"
$BrainWeightsDir = Join-Path $BrainDir "models\nnunet_brats\nnUNetTrainer__nnUNetPlans__3d_fullres"
$BrainAtlasPath = Join-Path $BrainDir "resources\atlases\AAL3\AAL3v1_1mm.nii.gz"

$MaxRetries = 30

function Test-PythonModule {
    param(
        [string]$PythonPath,
        [string]$ModuleName
    )

    & $PythonPath -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('$ModuleName') else 1)" *> $null
    return $LASTEXITCODE -eq 0
}

function Ensure-Pip {
    param([string]$PythonPath)

    if (Test-PythonModule -PythonPath $PythonPath -ModuleName "pip") {
        return
    }

    Write-Host "Bootstrapping pip in $(Split-Path $PythonPath -Parent)..." -ForegroundColor Yellow
    & $PythonPath -m ensurepip --upgrade
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to bootstrap pip for $PythonPath"
    }
}

function Ensure-PythonModule {
    param(
        [string]$PythonPath,
        [string]$ModuleName,
        [string]$PackageName,
        [switch]$Optional
    )

    if (Test-PythonModule -PythonPath $PythonPath -ModuleName $ModuleName) {
        return $true
    }

    Ensure-Pip -PythonPath $PythonPath
    Write-Host "Installing $PackageName for module '$ModuleName'..." -ForegroundColor Yellow
    & $PythonPath -m pip install $PackageName
    if ($LASTEXITCODE -eq 0) {
        return $true
    }

    if ($Optional) {
        Write-Host "WARNING: Failed to install optional package $PackageName. Brain MCP will run with degraded localization." -ForegroundColor Red
        return $false
    }

    throw "Failed to install required package $PackageName"
}

function Wait-JsonHealth {
    param(
        [string]$Name,
        [string]$Url,
        [string]$ExpectedStatus = "ok"
    )

    for ($i = 0; $i -lt $MaxRetries; $i++) {
        try {
            $resp = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 3 -ErrorAction Stop
            if ($resp.status -eq $ExpectedStatus) {
                Write-Host "$Name is ready!" -ForegroundColor Green
                return
            }
        } catch {
            # Ignore and retry
        }
        Start-Sleep -Seconds 2
    }

    throw "$Name health check failed at $Url"
}

function Wait-HttpStatus {
    param(
        [string]$Name,
        [string]$Url,
        [int]$ExpectedStatus = 200
    )

    for ($i = 0; $i -lt $MaxRetries; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($resp.StatusCode -eq $ExpectedStatus) {
                Write-Host "$Name is ready!" -ForegroundColor Green
                return
            }
        } catch {
            # Ignore and retry
        }
        Start-Sleep -Seconds 2
    }

    throw "$Name health check failed at $Url"
}

function Start-PythonProcess {
    param(
        [string]$Name,
        [string]$PythonPath,
        [string]$WorkingDirectory,
        [string[]]$ArgumentList,
        [string]$WindowStyle = "Minimized"
    )

    Write-Host "Starting $Name..." -ForegroundColor Green
    $process = Start-Process -PassThru -WindowStyle $WindowStyle -FilePath $PythonPath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory
    Write-Host "  PID: $($process.Id)" -ForegroundColor DarkGray
    return $process
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Starting MedAgent Services (v5) " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

if (-not (Test-Path $BackendPython)) {
    throw "Backend Python not found at $BackendPython"
}

Ensure-PythonModule -PythonPath $BackendPython -ModuleName "nibabel" -PackageName "nibabel" | Out-Null
Ensure-PythonModule -PythonPath $BackendPython -ModuleName "ants" -PackageName "antspyx" -Optional | Out-Null

if (-not (Test-Path $BrainWeightsDir)) {
    Write-Host "WARNING: Brain MCP weights not found. The 8003 service will answer with mock fallback until nnU-Net weights are installed." -ForegroundColor Yellow
}

if (-not (Test-Path $BrainAtlasPath)) {
    Write-Host "WARNING: Brain atlas not found. The 8003 service will skip precise spatial localization." -ForegroundColor Yellow
}

$ChestProcess = Start-PythonProcess -Name "Chest MCP on :8002" -PythonPath $BackendPython -WorkingDirectory $ChestDir -ArgumentList @("server.py")
Wait-JsonHealth -Name "Chest MCP" -Url "http://localhost:8002/health"

$BrainProcess = Start-PythonProcess -Name "Brain MCP on :8003" -PythonPath $BackendPython -WorkingDirectory $BrainDir -ArgumentList @("server.py")
Wait-JsonHealth -Name "Brain MCP" -Url "http://localhost:8003/health"

$RagflowProcess = Start-PythonProcess -Name "RAGFlow Lite on :9380" -PythonPath $RagflowPythonToUse -WorkingDirectory $RagflowDir -ArgumentList @("-m", "api.app")
Wait-JsonHealth -Name "RAGFlow Lite" -Url "http://localhost:9380/api/knowledge/health"

$LangGraphBootstrap = "import os; os.chdir(r'$BackendDir'); from langgraph_cli.cli import cli; cli()"
$LangGraphProcess = Start-PythonProcess -Name "LangGraph on :2024" -PythonPath $BackendPython -WorkingDirectory $BackendDir -ArgumentList @(
    "-c", $LangGraphBootstrap,
    "dev",
    "--no-browser",
    "--allow-blocking",
    "--no-reload",
    "--server-log-level", "info",
    "--host", "127.0.0.1",
    "--port", "2024",
    "--config", $LangGraphConfig
)
Wait-HttpStatus -Name "LangGraph" -Url "http://127.0.0.1:2024/docs"

$GatewayProcess = Start-PythonProcess -Name "Gateway on :8001" -PythonPath $BackendPython -WorkingDirectory $BackendDir -ArgumentList @(
    "-m", "uvicorn", "app.gateway.app:app", "--host", "0.0.0.0", "--port", "8001"
) -WindowStyle "Normal"
Wait-JsonHealth -Name "Gateway" -Url "http://localhost:8001/health" -ExpectedStatus "healthy"

Write-Host "Services started." -ForegroundColor Cyan
Write-Host "  LangGraph : http://127.0.0.1:2024/docs" -ForegroundColor Cyan
Write-Host "  Gateway   : http://localhost:8001/health" -ForegroundColor Cyan
Write-Host "  Chest MCP : http://localhost:8002/health" -ForegroundColor Cyan
Write-Host "  Brain MCP : http://localhost:8003/health" -ForegroundColor Cyan
Write-Host "  RAGFlow   : http://localhost:9380/api/knowledge/health" -ForegroundColor Cyan
Write-Host "To stop them, close the spawned windows or stop the PIDs listed above." -ForegroundColor Cyan
