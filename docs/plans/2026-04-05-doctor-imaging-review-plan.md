# Doctor Imaging Review Closure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the doctor-side imaging review flow so chest X-ray results surface complete AI output, the viewer uses a tighter layout, and brain MRI uploads guide doctors through the required four-sequence workflow.

**Architecture:** Repair the chest X-ray backend contract first, then normalize the gateway response into a stable review schema, and finally update the doctor-side viewers and upload entrypoints to consume that schema and expose brain MRI guidance state.

**Tech Stack:** Python 3.12, FastAPI, pytest, Next.js 16, React 19, TypeScript 5.8, ESLint.

---

### Task 1: Lock chest X-ray backend behavior with failing tests

**Files:**
- Modify: `1_core_orchestrator/backend/tests/test_imaging_reports_router.py`
- Modify: `3_mcp_medical_vision/mcp_chest_xray/engine.py`

**Step 1: Write the failing tests**
- Add a regression test proving `analyze-cv` persists `densenet_probs`, `summary`, and `rejected` from the MCP result.
- Add a regression test proving the route maps `summary.disease_probabilities` fallback and top-level `densenet_probs` correctly.

**Step 2: Run the tests to verify they fail**
- Run: `Set-Location 1_core_orchestrator/backend; $env:PYTHONPATH='.'; $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'; .\.venv\Scripts\python.exe -m pytest tests/test_imaging_reports_router.py -q`

**Step 3: Write the minimal implementation**
- Initialize the chest X-ray engine warmup flag.
- Preserve full MCP result structure in the gateway formatter.

**Step 4: Run the tests again**
- Re-run the same pytest command and confirm green.

### Task 2: Normalize doctor review save/load semantics

**Files:**
- Modify: `1_core_orchestrator/backend/app/gateway/routers/imaging_reports.py`
- Modify: `1_core_orchestrator/frontend/src/components/doctor/ImagingViewer.tsx`

**Step 1: Write the failing test**
- Add a backend regression test showing doctor review payloads preserve `summary`, `densenet_probs`, and `rejected` when only findings change.

**Step 2: Run the test to verify it fails**
- Run the targeted pytest selection for the new case.

**Step 3: Implement the minimal code**
- Normalize `doctor_result ?? ai_result` into a single frontend review shape.
- Update export/save so unchanged AI metadata is retained.

**Step 4: Run the targeted backend tests again**
- Confirm the persistence contract is green.

### Task 3: Tighten the chest X-ray viewer layout and show missing AI information

**Files:**
- Modify: `1_core_orchestrator/frontend/src/components/doctor/ImagingViewer.tsx`

**Step 1: Refactor the viewer data types**
- Add explicit support for `summary`, `densenet_probs`, `rejected`, `pipeline`, and `disclaimer`.

**Step 2: Update the layout**
- Reduce the image stage height.
- Add summary, probability, and rejected-candidate cards.

**Step 3: Keep editing UX intact**
- Preserve bbox editing, saving, undo/redo, and JSON export.

**Step 4: Verify frontend static checks**
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm exec eslint src/components/doctor/ImagingViewer.tsx`
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm typecheck`

### Task 4: Add guided brain MRI four-sequence upload

**Files:**
- Modify: `1_core_orchestrator/frontend/src/components/doctor/EvidenceDesk.tsx`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/uploads.py`
- Test: `1_core_orchestrator/backend/tests/test_uploads_router.py`

**Step 1: Write the failing backend tests**
- Add coverage for brain MRI guidance metadata: required sequences, detected sequences, missing sequences.

**Step 2: Run the test to verify it fails**
- Run: `Set-Location 1_core_orchestrator/backend; $env:PYTHONPATH='.'; $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'; .\.venv\Scripts\python.exe -m pytest tests/test_uploads_router.py -q`

**Step 3: Implement backend guidance metadata**
- Project sequence-detection state into the NIfTI placeholder structured data.

**Step 4: Implement frontend guided upload UI**
- Keep the generic upload button.
- Add a distinct brain MRI upload action with requirements text and missing-sequence status.

**Step 5: Re-run backend tests and frontend static checks**
- Re-run the upload pytest command.
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm exec eslint src/components/doctor/EvidenceDesk.tsx`

### Task 5: End-to-end verification and docs sync

**Files:**
- Modify: `1_core_orchestrator/backend/README.md`
- Modify: `1_core_orchestrator/backend/CLAUDE.md`
- Modify: `1_core_orchestrator/frontend/CLAUDE.md`

**Step 1: Update docs**
- Document the richer chest X-ray review payload and guided brain MRI upload behavior.

**Step 2: Run final backend verification**
- Run: `Set-Location 1_core_orchestrator/backend; $env:PYTHONPATH='.'; $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'; .\.venv\Scripts\python.exe -m pytest tests/test_imaging_reports_router.py tests/test_uploads_router.py -q`

**Step 3: Run final frontend verification**
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm exec eslint "src/components/doctor/**/*.tsx"`
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm typecheck`