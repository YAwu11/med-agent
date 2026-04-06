@echo off
REM ============================================================
REM  脑肿瘤 3D NIfTI MCP 微服务启动脚本
REM  端口: 8003  |  协议: SSE (Model Context Protocol)
REM ============================================================

echo.
echo  ========================================
echo   MCP Brain Tumor 3D Pipeline Server
echo   Port: 8003  Protocol: SSE
echo  ========================================
echo.

cd /d "%~dp0brain_tumor_pipeline"

REM 检查 Python 环境
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found in PATH. Please install Python 3.10+.
    pause
    exit /b 1
)

REM 检查关键依赖
python -c "import nibabel; import mcp; import cv2" 2>nul
if errorlevel 1 (
    echo [WARN] Missing dependencies. Installing from requirements.txt...
    pip install -r requirements.txt
)

REM 检查模型权重目录
if not exist "models\nnunet_brats\nnUNetTrainer__nnUNetPlans__3d_fullres" (
    echo [WARN] nnU-Net weights not found at models/nnunet_brats/
    echo [WARN] Pipeline will run in MOCK mode (synthetic tumor mask).
    echo.
)

REM 检查图谱文件
if not exist "resources\atlases\AAL3\AAL3v1_1mm.nii.gz" (
    echo [WARN] AAL3 atlas not found at resources/atlases/AAL3/
    echo [WARN] Spatial localization will fall back to volume-only mode.
    echo.
)

echo [INFO] Starting MCP Brain Tumor Server on port 8003...
echo [INFO] Press Ctrl+C to stop.
echo.

python server.py
