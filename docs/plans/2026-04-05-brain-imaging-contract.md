# Brain Imaging Contract Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify brain NIfTI review flow with the existing chest imaging review shell while keeping a brain-specific viewer and explicitly limiting brain support to NIfTI uploads.

**Architecture:** Introduce a stable report contract shared by chest and brain evidence items. Evidence records keep lightweight projection fields such as `report_id`, `modality`, `viewer_kind`, and `status`, while detailed AI/doctor review payloads remain in imaging report records. Brain NIfTI uploads create or reuse a stable report id across processing, doctor review, and final report generation.

**Tech Stack:** FastAPI, SQLite persistence, pytest, Next.js 16, TypeScript.

---

### Task 1: Lock the backend contract with failing tests

**Files:**
- Modify: `1_core_orchestrator/backend/tests/test_imaging_reports_router.py`
- Modify: `1_core_orchestrator/backend/tests/test_uploads_router.py`
- Modify: `1_core_orchestrator/backend/tests/test_patient_record_context.py`

**Step 1: Write failing tests for stable report/evidence linking**
- Add a test that doctor review sync updates a case evidence item by `structured_data.report_id`, not only by `evidence_id`.
- Add a test that brain report generation persists review state under `structured_data` and updates the linked report record.
- Add a test that a completed brain report is visible to patient record context for the original NIfTI upload.

**Step 2: Run the targeted tests and confirm they fail for the expected reason**
- Run: `pytest tests/test_imaging_reports_router.py tests/test_uploads_router.py tests/test_patient_record_context.py -q`

### Task 2: Unify backend imaging report linkage

**Files:**
- Modify: `1_core_orchestrator/backend/app/gateway/services/analyzers/xray_mcp.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/analyzers/brain_mcp.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/brain_nifti_pipeline.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/uploads.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/brain_report.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/case_db.py`

**Step 1: Add stable report projection fields**
- Ensure chest and brain evidence `structured_data` include `report_id`, `modality`, `viewer_kind`, and a normalized `status`.

**Step 2: Reuse a stable brain report id across the whole lifecycle**
- Generate a report id before queuing the async NIfTI task.
- Pass it through the background pipeline and into the brain analyzer.
- Persist a report record for processing, then update that same record when analysis completes.

**Step 3: Persist doctor review into both evidence and report records**
- Store brain review completion under `structured_data` instead of unsupported top-level evidence fields.
- Mark the linked report as reviewed and persist doctor-facing payload.

### Task 3: Enforce NIfTI-only brain support

**Files:**
- Modify: `1_core_orchestrator/backend/app/gateway/services/analyzers/__init__.py`
- Add: `1_core_orchestrator/backend/app/gateway/services/analyzers/brain_image_notice.py`

**Step 1: Stop routing 2D brain screenshots into the 3D brain analyzer**
- Replace the current `brain_mri` analyzer binding with a lightweight analyzer that returns an explicit unsupported message and guidance to upload NIfTI sequences.

### Task 4: Align frontend doctor viewer with the real report contract

**Files:**
- Modify: `1_core_orchestrator/frontend/src/components/doctor/EvidenceDesk.tsx`
- Modify: `1_core_orchestrator/frontend/src/components/doctor/ImagingViewer.tsx`
- Modify: `1_core_orchestrator/frontend/src/components/doctor/BrainSpatialReview.tsx`

**Step 1: Pass the real report id from evidence structured data**
- Use `structured_data.report_id` when opening imaging viewers.

**Step 2: Fetch live report data even when lightweight initial structured data exists**
- Keep initial data only as bootstrap state.
- Prefer the linked report payload once fetched.

**Step 3: Normalize brain status rendering**
- Treat `processing`, `pending_review`, and `reviewed` as the stable states.
- Keep the brain-specific visualization and report generation UI.

### Task 5: Verify the whole slice

**Files:**
- Modify if needed: `1_core_orchestrator/backend/README.md`
- Modify if needed: `1_core_orchestrator/backend/CLAUDE.md`

**Step 1: Run targeted backend tests**
- Run: `pytest tests/test_imaging_reports_router.py tests/test_uploads_router.py tests/test_patient_record_context.py -q`

**Step 2: Run the brain-specific unit and live smoke tests if backend changes touch the 3D path**
- Run: `pytest ..\..\3_mcp_medical_vision\brain_tumor_pipeline\test_engine_3d_pytest.py -q`
- Run: `RUN_BRAIN_MCP_LIVE=1 PYTHONPATH=. PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 pytest tests/test_brain_mcp_live.py -q`

**Step 3: Run frontend type/lint validation for touched files**
- Run: `pnpm exec eslint "src/components/doctor/**/*.{ts,tsx}"`
- Run: `pnpm typecheck`