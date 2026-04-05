param()

$ScriptDir = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
$RepoRoot = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $RepoRoot "1_core_orchestrator\backend"
$BackendPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
$RequirementsFile = Join-Path $BackendDir "requirements-local-lab-ocr.txt"
$CheckerScript = Join-Path $BackendDir "scripts\check_local_lab_ocr.py"

function Get-ListeningMedPorts {
    $ports = @(2024, 8001, 8002, 8003)
    $active = @()

    foreach ($port in $ports) {
        $listening = netstat -ano | Select-String ":$port " | Select-String "LISTENING"
        if ($listening) {
            $active += $port
        }
    }

    return $active
}

function Ensure-Pip {
    param([string]$PythonPath)

    & $PythonPath -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('pip') else 1)" *> $null
    if ($LASTEXITCODE -eq 0) {
        return
    }

    Write-Host "Bootstrapping pip for backend .venv..." -ForegroundColor Yellow
    & $PythonPath -m ensurepip --upgrade
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to bootstrap pip in backend .venv"
    }
}

if (-not (Test-Path $BackendPython)) {
    throw "Backend Python not found at $BackendPython. Run 'uv sync' in 1_core_orchestrator/backend first."
}

if (-not (Test-Path $RequirementsFile)) {
    throw "Optional lab OCR requirements file not found at $RequirementsFile"
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Install Optional Local Lab OCR Stack " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Target backend environment: $BackendPython" -ForegroundColor Cyan
Write-Host "Requirements file: $RequirementsFile" -ForegroundColor Cyan

$ActiveMedPorts = Get-ListeningMedPorts
if ($ActiveMedPorts.Count -gt 0) {
    throw "Detected running MedAgent services on ports $($ActiveMedPorts -join ', '). Stop them before installing local OCR dependencies to avoid Windows file-lock errors in backend/.venv."
}

Ensure-Pip -PythonPath $BackendPython

& $BackendPython -m pip install -r $RequirementsFile
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install optional local lab OCR dependencies into backend .venv"
}

Write-Host "Re-checking local OCR runtime mode..." -ForegroundColor Green
Push-Location $BackendDir
try {
    $env:PYTHONPATH = "."
    & $BackendPython $CheckerScript
    if ($LASTEXITCODE -ne 0) {
        throw "Local OCR runtime check failed after installation"
    }
} finally {
    Pop-Location
}