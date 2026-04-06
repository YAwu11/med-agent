# Brain Imaging Patient And Artifact Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the verified brain NIfTI doctor-review flow to patient-facing cards, appointment preview, case summary, and workspace artifact viewing without changing the stable report contract.

**Architecture:** Reuse the existing report projection fields already persisted on brain evidence and imaging-report files. The backend snapshot layer becomes the single source of truth for patient-facing evidence cards and appointment preview, while the frontend artifact panel detects brain report JSON and renders a read-only brain viewer keyed by `viewer_kind` and `pipeline`.

**Tech Stack:** FastAPI, pytest, Next.js 16, React 19, TypeScript.

---

### Task 1: Lock patient-facing brain evidence projection

**Files:**
- Modify: `1_core_orchestrator/backend/tests/test_patient_record_context.py`
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/patient_record_context.py`

**Step 1: Write the failing test**
- Add a test asserting that a brain NIfTI report projects `report_id`, `pipeline`, `viewer_kind`, `modality`, `slice_png_path`, `spatial_info`, and `review_status` into `evidence_items`.

**Step 2: Run test to verify it fails**
- Run: `pytest tests/test_patient_record_context.py -q`

**Step 3: Write minimal implementation**
- Enrich the snapshot builder for brain MRI evidence while preserving existing generic imaging fields.

**Step 4: Run test to verify it passes**
- Run: `pytest tests/test_patient_record_context.py -q`

### Task 2: Unify appointment preview with snapshot contract

**Files:**
- Modify: `1_core_orchestrator/backend/tests/test_appointment_router.py`
- Modify: `1_core_orchestrator/backend/app/core/tools/builtins/preview_appointment.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/appointment.py`

**Step 1: Write the failing test**
- Add a test asserting that `GET /appointment-preview` returns the same brain evidence fields from the snapshot contract.

**Step 2: Run test to verify it fails**
- Run: `pytest tests/test_appointment_router.py -q`

**Step 3: Write minimal implementation**
- Replace duplicated file-scanning logic with `build_patient_record_snapshot(...)` in both the tool and REST endpoint.

**Step 4: Run test to verify it passes**
- Run: `pytest tests/test_appointment_router.py -q`

### Task 3: Make case summary brain-aware

**Files:**
- Modify: `1_core_orchestrator/backend/tests/test_cases_router.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/cases.py`

**Step 1: Write the failing test**
- Add a test asserting that brain MRI evidence is summarized as brain-specific text rather than raw JSON-only output.

**Step 2: Run test to verify it fails**
- Run: `pytest tests/test_cases_router.py -q`

**Step 3: Write minimal implementation**
- Add a formatter for brain MRI evidence that emits review status, location, findings summary, and doctor report text when present.

**Step 4: Run test to verify it passes**
- Run: `pytest tests/test_cases_router.py -q`

### Task 4: Render brain MRI in patient cards and artifact panel

**Files:**
- Modify: `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordCard.tsx`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/AppointmentPreview.tsx`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/artifacts/artifact-file-detail.tsx`
- Add: `1_core_orchestrator/frontend/src/components/workspace/artifacts/brain-artifact-viewer.tsx`

**Step 1: Implement UI branches from the stable fields**
- Add brain-aware badges and summary rows in patient cards.
- Detect brain report JSON in the artifact panel and render a read-only viewer with slice preview, spatial summary, and report text.

**Step 2: Validate frontend**
- Run: `pnpm lint`
- Run: `pnpm typecheck`
- Run: `pnpm build`

### Task 5: Align patient prompt wording and final verification

**Files:**
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/agents/lead_agent/prompt.py`

**Step 1: Update the wording**
- Make patient guidance explicitly distinguish ordinary image uploads from the NIfTI-only brain MRI flow.

**Step 2: Run full verification**
- Run: `pytest tests/test_patient_record_context.py tests/test_appointment_router.py tests/test_cases_router.py -q`
- Run: `RUN_BRAIN_MCP_LIVE=1 PYTHONPATH=. PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 pytest tests/test_brain_mcp_live.py -q`
- Run: `pnpm lint`
- Run: `pnpm typecheck`
- Run: `pnpm build`