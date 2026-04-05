# Lab OCR Environment Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make lab-report OCR environment behavior explicit and consistent across backend runtime, startup helpers, and operator documentation.

**Architecture:** Keep the production-safe local-to-remote OCR fallback as the default runtime path. Add a Python runtime checker plus an optional installation script for local Paddle OCR packages, then make the desktop controller and Windows startup helper surface that state directly.

**Tech Stack:** Python 3.12, FastAPI backend, PowerShell, Windows batch, pytest.

---

### Task 1: Lock the runtime status contract with failing tests

**Files:**
- Create: `1_core_orchestrator/backend/tests/test_local_lab_ocr_runtime.py`
- Create: `1_core_orchestrator/backend/app/gateway/services/local_lab_ocr_runtime.py`

**Step 1: Write the failing test**
- Add a test asserting the runtime checker reports `available=False` and includes missing module names when `paddleocr`, `paddle`, and `paddlex` are unavailable.
- Add a test asserting the runtime checker reports `available=True` when all required modules are present.

**Step 2: Run the test to verify it fails**
- Run: `PYTHONPATH=. .venv\Scripts\python.exe -m pytest tests/test_local_lab_ocr_runtime.py -q`

### Task 2: Add a single source of truth for local OCR availability

**Files:**
- Create: `1_core_orchestrator/backend/app/gateway/services/local_lab_ocr_runtime.py`
- Create: `1_core_orchestrator/backend/scripts/check_local_lab_ocr.py`

**Step 1: Implement the runtime checker**
- Return a structured availability object with required modules, missing modules, and a human-readable mode string.

**Step 2: Implement a small CLI wrapper**
- Print a concise machine-readable and human-readable status for use by batch and PowerShell helpers.

**Step 3: Run targeted tests**
- Run: `PYTHONPATH=. .venv\Scripts\python.exe -m pytest tests/test_local_lab_ocr_runtime.py -q`

### Task 3: Add an optional local OCR install entrypoint

**Files:**
- Create: `1_core_orchestrator/backend/requirements-local-lab-ocr.txt`
- Create: `scripts/install_local_lab_ocr.ps1`

**Step 1: Pin the optional local OCR dependency set**
- Add the versions already documented by `local_paddle_ocr.py`.

**Step 2: Add a PowerShell installer**
- Install the optional dependency set into `1_core_orchestrator/backend/.venv`.
- Re-run the runtime checker at the end and print the resulting mode.

### Task 4: Surface OCR mode in startup and control scripts

**Files:**
- Modify: `scripts/start/start_all_with_mcp.ps1`
- Modify: `e:\桌面\控制台.bat`

**Step 1: Make startup helper report the OCR mode**
- Before starting services, check local OCR availability and print whether the current backend will use local OCR or cloud fallback.

**Step 2: Make desktop environment check report the same mode**
- Extend the environment check section with local OCR status.
- Add the optional local OCR installation command to the setup instructions.

### Task 5: Update docs and verify end-to-end

**Files:**
- Modify: `1_core_orchestrator/backend/README.md`
- Modify: `1_core_orchestrator/backend/CLAUDE.md`

**Step 1: Document the two supported modes**
- Clarify what `uv sync` gives by default.
- Add the optional local OCR install path.

**Step 2: Run verification**
- Run: `PYTHONPATH=. .venv\Scripts\python.exe -m pytest tests/test_local_lab_ocr_runtime.py tests/test_lab_ocr_analyzer.py tests/test_uploads_router.py -q`
- Run: `PYTHONPATH=. .venv\Scripts\python.exe backend/scripts/check_local_lab_ocr.py`

**Step 3: Optional machine-local closure**
- Run: `powershell -ExecutionPolicy Bypass -File scripts/install_local_lab_ocr.ps1`
- Re-run: `PYTHONPATH=. .venv\Scripts\python.exe backend/scripts/check_local_lab_ocr.py`