# Patient-Doctor Workflow Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the patient/doctor/case/imaging workflow so state ownership is explicit, report persistence is no longer split across file-system and database reads, thread identity is decoupled from case identity, and SSE delivery has a clean abstraction without changing current doctor-desk behavior.

**Architecture:** Keep `1_core_orchestrator` as a modular monolith. Do not split services. Introduce explicit gateway workflow services and make SQLite the authoritative store for case/report state; sandbox JSON remains a tool-facing write-through cache required by `preview_appointment`, `schedule_appointment`, and `deerflow.patient_record_context`, not a second mutable source of truth. Keep in-memory SSE for local use, but hide it behind an `EventBus` seam while preserving the current broadcast-all `/api/cases/stream` contract.

**Tech Stack:** FastAPI, Pydantic v2, SQLite, Next.js App Router, React 19, TypeScript, pytest, pnpm, uv.

---

## Scope

### In

- `1_core_orchestrator/backend/app/gateway/routers/cases.py`
- `1_core_orchestrator/backend/app/gateway/routers/appointment.py`
- `1_core_orchestrator/backend/app/gateway/routers/imaging_reports.py`
- `1_core_orchestrator/backend/app/gateway/routers/uploads.py`
- `1_core_orchestrator/backend/app/gateway/services/case_db.py`
- `1_core_orchestrator/backend/app/gateway/services/analyzers/xray_mcp.py`
- `1_core_orchestrator/backend/app/gateway/services/analyzers/brain_mcp.py`
- `1_core_orchestrator/backend/app/gateway/services/brain_nifti_pipeline.py`
- `1_core_orchestrator/backend/app/core/tools/builtins/save_analysis_result.py`
- `1_core_orchestrator/backend/app/core/tools/builtins/submit_for_review.py`
- `1_core_orchestrator/backend/app/core/mcp/tools.py`
- `1_core_orchestrator/backend/app/core/tools/builtins/preview_appointment.py`
- `1_core_orchestrator/backend/app/core/tools/builtins/schedule_appointment.py`
- new gateway workflow services for case lookup, patient-info writes, report persistence, and event delivery
- `1_core_orchestrator/frontend/src/core/api/cases.ts`
- `1_core_orchestrator/frontend/src/core/imaging/api.ts`
- `1_core_orchestrator/frontend/src/components/doctor/EvidenceDesk.tsx`
- `1_core_orchestrator/frontend/src/components/doctor/ImagingViewer.tsx`
- targeted backend/frontend regression tests and ADR/docs sync

### Out

- microservices extraction
- full RBAC / auth redesign
- Redis deployment work as a hard dependency for local development
- large visual redesign of doctor UI
- replacing SQLite in this refactor batch

## Architecture Decisions

### Decision 1: Keep the modular monolith, add service seams

- **Problem:** Route handlers currently contain workflow orchestration, storage sync, and broadcast logic inline.
- **Chosen:** Create focused gateway services instead of splitting apps or adding cross-process architecture now.
- **Why:** Current team/runtime shape does not justify microservices. The immediate issue is hidden coupling, not independent scaling.
- **Trade-off:** Some route files will temporarily become thinner wrappers around more service modules, increasing file count.

### Decision 2: Database is the source of truth for case/report workflow state

- **Problem:** Imaging/report state is mutated in sandbox JSON, `reports` rows, and `Case.evidence` projection.
- **Chosen:** Persist canonical report state in database rows. Treat sandbox JSON as input/output artifact only.
- **Why:** Reads become deterministic and doctor edits stop depending on opportunistic re-sync during GETs.
- **Trade-off:** One extra service layer is required to project report state back into `Case.evidence` and mirror selected state back into sandbox JSON until tool and harness consumers migrate.

### Decision 3: `thread_id` identifies a conversation, not a case

- **Problem:** `patient_thread_id` and `case_id` are partially conflated, which makes re-registration and doctor-created cases ambiguous.
- **Chosen:** Keep `case_id` as the case primary key and make thread-based lookup explicit and named by semantics. In this batch, `/api/cases/by-thread/{thread_id}` remains a compatibility route that resolves the latest active case.
- **Why:** It removes hidden assumptions from `get_case_by_thread()` and from the current `create_case()` fallback, while keeping patient status and upload flows stable.
- **Trade-off:** Existing callers need a compatibility layer during migration, and doctor-created cases need a synthetic stable `patient_thread_id` instead of silently reusing `case_id`.

### Decision 4: SSE transport needs an abstraction now, broker later

- **Problem:** `_sse_subscribers` is a process-local global list and will not survive multi-worker or multi-instance deployment.
- **Chosen:** Introduce an `EventBus` protocol with an in-memory implementation first, preserving the current broadcast-all runtime behavior.
- **Why:** This solves the route coupling immediately and keeps Redis optional until deployment pressure exists.
- **Trade-off:** Slightly more abstraction than today, but this batch intentionally does not add doctor-thread-scoped filtering because the current event contract does not support it.

### Decision 5: Normalize boundary-specific evidence vocabulary at adapters

- **Problem:** The sandbox and tool layer currently emits values such as `lab_report` and `ocr`, while the case domain model and doctor workbench use a different vocabulary.
- **Chosen:** Keep tool-facing payloads stable, but normalize these labels at gateway workflow boundaries before persisting `Case` and `reports` records.
- **Why:** This prevents validation drift from being baked into the domain model and keeps patient-side cards, tool prompts, and doctor-side records independently evolvable.
- **Trade-off:** A small mapping layer must be maintained and regression-tested.

## Source-Review Corrections

- `deerflow.patient_record_context.build_patient_record_snapshot()` still reads `patient_intake.json` and `imaging-reports/*.json` directly, so this plan keeps sandbox files as a mirrored cache instead of importing gateway services into the harness layer.
- `preview_appointment.py` and `schedule_appointment.py` still depend on `get_case_by_thread()` and sandbox report files, so Task 3 and Task 5 must update built-in tools alongside gateway routes.
- Report JSON is currently written by `imaging_reports.py`, `xray_mcp.py`, `brain_mcp.py`, `brain_nifti_pipeline.py`, `save_analysis_result.py`, `submit_for_review.py`, and the HITL interception path in `app/core/mcp/tools.py`; centralizing only the router path would not fix the split write model.
- `frontend/src/core/imaging/api.ts` already exists and is used outside the doctor desk, so this refactor extends that client instead of creating a second imaging API layer.

---

## Task 1: Freeze Existing Workflow Contracts With Tests

Files:

- Create: `1_core_orchestrator/backend/tests/test_imaging_reports_router.py`
- Create: `1_core_orchestrator/backend/tests/test_case_identity.py`
- Create: `1_core_orchestrator/backend/tests/test_appointment_tools.py`
- Modify: `1_core_orchestrator/backend/tests/test_cases_router.py`
- Modify: `1_core_orchestrator/backend/tests/test_appointment_router.py`
- Modify: `1_core_orchestrator/backend/tests/test_patient_record_context.py`

1. Write failing tests for the contracts that must survive the refactor.

```python
def test_list_imaging_reports_returns_empty_without_registered_case():
    ...

def test_confirm_appointment_normalizes_lab_report_payload_before_case_persist():
    ...

def test_doctor_side_patient_info_patch_keeps_patient_record_snapshot_in_sync():
    ...

def test_submit_doctor_review_updates_report_and_case_projection_once():
    ...

def test_get_latest_case_by_patient_thread_prefers_newest_case():
    ...
```

1. Run the new tests to verify they fail for the not-yet-implemented semantics.

```powershell
Set-Location "1_core_orchestrator/backend"
.venv\Scripts\python.exe -m pytest tests/test_imaging_reports_router.py tests/test_case_identity.py tests/test_appointment_tools.py -v
```

Expected: failure.

1. Re-run the existing workflow tests to keep the current baseline green.

```powershell
Set-Location "1_core_orchestrator/backend"
.venv\Scripts\python.exe -m pytest tests/test_appointment_router.py tests/test_cases_router.py tests/test_patient_record_context.py -v
```

Expected: pass.

1. Commit.

```powershell
git add 1_core_orchestrator/backend/tests
git commit -m "test(backend): freeze patient doctor workflow contracts"
```

---

## Task 2: Introduce Explicit Workflow Service Seams

Status (2026-04-04): Implemented in the active patient-doctor workflow worktree. `event_bus.py`, `case_locator.py`, `report_service.py`, and the class-backed `patient_info_service.py` now wrap the legacy `case_db` primitives, with focused seam coverage added in `test_case_identity.py` and `test_imaging_reports_router.py`.

Files:

- Create: `1_core_orchestrator/backend/app/gateway/services/event_bus.py`
- Create: `1_core_orchestrator/backend/app/gateway/services/case_locator.py`
- Create: `1_core_orchestrator/backend/app/gateway/services/patient_info_service.py`
- Create: `1_core_orchestrator/backend/app/gateway/services/report_service.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/__init__.py`

1. Define thin, testable interfaces.

```python
class EventBus(Protocol):
    def publish(self, event_type: str, payload: dict) -> None: ...
    def subscribe(self) -> AsyncIterator[str]: ...

class CaseLocator(Protocol):
    def get_latest_case_by_patient_thread(self, thread_id: str) -> Case | None: ...
```

1. Implement `InMemoryEventBus`, `SqliteCaseLocator`, `PatientInfoService`, and `ReportService` as wrappers around the current `case_db` primitives, including boundary normalizers for labels such as `lab_report` -> `lab` and `ocr` -> an allowed persisted source value.

1. Run focused tests.

```powershell
Set-Location "1_core_orchestrator/backend"
.venv\Scripts\python.exe -m pytest tests/test_case_identity.py tests/test_appointment_tools.py -v
```

Expected: pass.

1. Commit.

```powershell
git add 1_core_orchestrator/backend/app/gateway/services 1_core_orchestrator/backend/tests
git commit -m "refactor(backend): add workflow service seams for cases reports and events"
```

---

## Task 3: Normalize Case Identity Semantics

Files:

- Modify: `1_core_orchestrator/backend/app/gateway/services/case_db.py`
- Modify: `1_core_orchestrator/backend/app/gateway/models/case.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/appointment.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/cases.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/uploads.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/brain_nifti_pipeline.py`
- Modify: `1_core_orchestrator/backend/app/core/tools/builtins/preview_appointment.py`
- Modify: `1_core_orchestrator/backend/app/core/tools/builtins/schedule_appointment.py`
- Modify: `1_core_orchestrator/frontend/src/core/api/cases.ts`

1. Replace ambiguous thread lookup APIs with explicit names.

```python
def get_latest_case_by_patient_thread(thread_id: str) -> Case | None:
    ...

def get_cases_by_patient_thread(thread_id: str) -> list[Case]:
    ...
```

1. Update every existing caller of `get_case_by_thread()` and `create_case()` that currently relies on case/thread aliasing.

- `preview_appointment.py`
- `schedule_appointment.py`
- `uploads.py`
- `imaging_reports.py`
- `brain_nifti_pipeline.py`
- `/api/cases/by-thread/{thread_id}` compatibility route

1. Stop overloading `patient_thread_id` with case identity.

- patient-confirm flow keeps the patient conversation `thread_id` separate from `case_id`
- doctor quick-create flow gets a synthetic stable `patient_thread_id` so uploads and sandbox APIs still work
- thread-based lookup always has deterministic ordering (`created_at DESC`)
- public `/api/cases/by-thread/{thread_id}` stays singular in this batch and resolves the latest active case for compatibility

1. Run targeted tests.

```powershell
Set-Location "1_core_orchestrator/backend"
.venv\Scripts\python.exe -m pytest tests/test_case_identity.py tests/test_appointment_router.py tests/test_cases_router.py tests/test_appointment_tools.py -v
```

Expected: pass.

1. Commit.

```powershell
git add 1_core_orchestrator/backend/app/gateway 1_core_orchestrator/frontend/src/core/api/cases.ts 1_core_orchestrator/backend/tests
git commit -m "refactor(backend): normalize case identity and thread lookup semantics"
```

---

## Task 4: Unify Patient Information Writes

Files:

- Modify: `1_core_orchestrator/backend/app/gateway/routers/appointment.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/cases.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/patient_info_service.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/case_db.py`
- Modify: `1_core_orchestrator/frontend/src/core/api/cases.ts`
- Modify: `1_core_orchestrator/frontend/src/components/doctor/EvidenceDesk.tsx`

1. Add a single backend write path.

```python
def apply_patient_info_patch(
    *,
    case_id: str | None = None,
    patient_thread_id: str | None = None,
    patch: dict,
    source: Literal["patient", "doctor"],
) -> Case | None:
    ...
```

1. Route both patient and doctor writes through it.

- `PATCH /api/threads/{thread_id}/patient-intake` stays as the patient-side route
- `PATCH /api/cases/{case_id}/patient-info` stays as the doctor-side route
- both call the same service and apply the same merge rules

1. Because `deerflow.patient_record_context.build_patient_record_snapshot()` still reads sandbox `patient_intake.json` and the harness layer must not import from `app/`, mirror canonical patient-info writes back to sandbox inside `PatientInfoService`.

1. Update `EvidenceDesk.tsx` to use the typed `updatePatientInfo()` API client consistently instead of mixing raw `fetch()` and local mutation paths, and refresh local state from the returned `CaseData` when the patch succeeds.

1. Run tests and frontend validation.

```powershell
Set-Location "1_core_orchestrator/backend"
.venv\Scripts\python.exe -m pytest tests/test_appointment_router.py tests/test_cases_router.py tests/test_patient_record_context.py -v

Set-Location "../frontend"
pnpm exec eslint "src/components/doctor/EvidenceDesk.tsx" "src/core/api/cases.ts"
pnpm typecheck
```

Expected: all pass.

1. Commit.

```powershell
git add 1_core_orchestrator/backend/app/gateway 1_core_orchestrator/frontend/src/components/doctor/EvidenceDesk.tsx 1_core_orchestrator/frontend/src/core/api/cases.ts
git commit -m "refactor(workflow): unify patient info writes across patient and doctor flows"
```

---

## Task 5: Make Report Rows the Authoritative Imaging State

Status (2026-04-04): Implemented for the current imaging-report flow. `ReportService` now owns report persistence, doctor review application, sandbox write-through syncing, and `Case.evidence` projection. The typed frontend client in `src/core/imaging/api.ts` is now the shared imaging API authority consumed by `ImagingViewer.tsx`.

Files:

- Modify: `1_core_orchestrator/backend/app/gateway/services/report_service.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/case_db.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/imaging_reports.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/uploads.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/analyzers/xray_mcp.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/analyzers/brain_mcp.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/brain_nifti_pipeline.py`
- Modify: `1_core_orchestrator/backend/app/core/tools/builtins/save_analysis_result.py`
- Modify: `1_core_orchestrator/backend/app/core/tools/builtins/submit_for_review.py`
- Modify: `1_core_orchestrator/backend/app/core/mcp/tools.py`
- Modify: `1_core_orchestrator/frontend/src/core/imaging/api.ts`
- Modify: `1_core_orchestrator/frontend/src/components/doctor/ImagingViewer.tsx`

1. Centralize report write and read operations.

```python
def persist_generated_report(...) -> ReportRecord: ...
def import_legacy_report_file(thread_id: str, file_path: Path) -> ReportRecord: ...
def list_reports_for_thread(thread_id: str, status: str | None = None) -> list[ReportRecord]: ...
def apply_doctor_review(report_id: str, doctor_result: dict) -> ReportRecord: ...
```

1. Route all current report writers through `ReportService`: `POST /analyze-cv`, `xray_mcp.py`, `brain_mcp.py`, `brain_nifti_pipeline.py`, `save_analysis_result.py`, `submit_for_review.py`, and the HITL interception path in `app/core/mcp/tools.py`.

1. Keep sandbox JSON as a write-through cache for `preview_appointment.py`, `schedule_appointment.py`, and `deerflow.patient_record_context`, but make `ReportService` the only module allowed to write report JSON.

1. Keep `Case.evidence` as the doctor-workbench projection. Route handlers and analyzers stop mutating imaging evidence directly; only `ReportService` may project report rows into that view until all readers migrate.

1. Extend the existing `src/core/imaging/api.ts` instead of creating a second imaging client, and make `ImagingViewer.tsx` consume typed imaging-report DTOs from it while keeping workspace artifact consumers compatible.

1. Run tests and validation.

```powershell
Set-Location "1_core_orchestrator/backend"
.venv\Scripts\python.exe -m pytest tests/test_imaging_reports_router.py tests/test_cases_router.py -v

Set-Location "../frontend"
pnpm exec eslint "src/components/doctor/ImagingViewer.tsx" "src/core/imaging/api.ts"
pnpm typecheck
```

Latest verification snapshot:

- Backend: `26 passed` across `test_case_identity.py`, `test_appointment_tools.py`, `test_imaging_reports_router.py`, `test_cases_router.py`, `test_appointment_router.py`, and `test_patient_record_context.py`.
- Frontend: targeted ESLint clean for `ImagingViewer.tsx` and `src/core/imaging/api.ts`.
- Frontend: `pnpm typecheck` clean after the typed imaging-client consolidation.
- Backend: targeted Ruff clean for the touched router/service/tool files involved in Task 2 and Task 5.

Expected: pass.

1. Commit.

```powershell
git add 1_core_orchestrator/backend/app/gateway 1_core_orchestrator/frontend/src/components/doctor/ImagingViewer.tsx 1_core_orchestrator/frontend/src/core/imaging/api.ts 1_core_orchestrator/backend/tests
git commit -m "refactor(imaging): make database rows the source of truth for report state"
```

---

## Task 6: Extract the Case Event Bus Without Expanding the Stream Contract

Files:

- Modify: `1_core_orchestrator/backend/app/gateway/services/event_bus.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/cases.py`
- Modify: `1_core_orchestrator/frontend/src/core/api/cases.ts`
- Create: `1_core_orchestrator/backend/tests/test_cases_streaming.py`

1. Replace `_sse_subscribers` with the event bus service.

1. Preserve the existing `/api/cases/stream` response format and broadcast-all semantics used by the doctor queue and patient status pages. Do not add `doctor_thread_id` filtering in this batch.

1. Deduplicate the duplicated `PUT /cases/{case_id}/diagnosis` handler while moving all event emission through the `EventBus` facade.

1. Update the `CaseEvent` union in `src/core/api/cases.ts` so it matches the events the backend already emits, including `case_deleted`, `patient_info_updated`, `evidence_updated`, and `evidence_deleted`.

1. Run targeted tests.

```powershell
Set-Location "1_core_orchestrator/backend"
.venv\Scripts\python.exe -m pytest tests/test_cases_streaming.py tests/test_cases_router.py -v

Set-Location "../frontend"
pnpm exec eslint "src/core/api/cases.ts"
pnpm typecheck
```

Expected: pass.

1. Commit.

```powershell
git add 1_core_orchestrator/backend/app/gateway/routers/cases.py 1_core_orchestrator/backend/app/gateway/services/event_bus.py 1_core_orchestrator/frontend/src/core/api/cases.ts 1_core_orchestrator/backend/tests
git commit -m "refactor(events): extract scoped event bus for case streaming"
```

---

## Task 7: Document the Workflow Boundaries and Migration Rules

Files:

- Create: `docs/architecture/adr-020-workflow-state-boundaries.md`
- Modify: `1_core_orchestrator/backend/README.md`
- Modify: `1_core_orchestrator/backend/CLAUDE.md`
- Modify: `1_core_orchestrator/frontend/README.md`
- Modify: `1_core_orchestrator/frontend/CLAUDE.md`

1. Write the ADR covering:

- why DB is the source of truth
- why thread lookup APIs were renamed
- why EventBus is abstracted but still in-memory by default
- which modules are allowed to write sandbox `patient_intake.json` and `imaging-reports/*.json`
- why built-in tools and `deerflow.patient_record_context` remain file-based in this batch

1. Update developer docs with the new regression test list and validation commands for:

- report workflow tests
- case streaming tests
- appointment tool and patient-record snapshot tests
- doctor-side frontend verification

1. Commit.

```powershell
git add docs/architecture 1_core_orchestrator/backend/README.md 1_core_orchestrator/backend/CLAUDE.md 1_core_orchestrator/frontend/README.md 1_core_orchestrator/frontend/CLAUDE.md
git commit -m "docs: record workflow state boundaries and refactor verification paths"
```

---

## Task 8: Full Verification and Cleanup Pass

Files:

- Modify as needed: any files touched in Tasks 1-7

1. Run backend regression suite for the workflow slice.

```powershell
Set-Location "1_core_orchestrator/backend"
.venv\Scripts\python.exe -m pytest tests/test_dependency_warnings.py tests/test_appointment_router.py tests/test_appointment_tools.py tests/test_cases_router.py tests/test_imaging_reports_router.py tests/test_cases_streaming.py tests/test_case_identity.py tests/test_patient_record_context.py -v
```

1. Run frontend validation for the doctor workflow slice.

```powershell
Set-Location "1_core_orchestrator/frontend"
pnpm exec eslint "src/components/doctor/**/*.tsx" "src/core/api/*.ts" "src/core/imaging/*.ts"
pnpm typecheck
```

1. Do a final diff review and verify that:

- route handlers no longer mutate report state during reads
- all current report writers go through `ReportService`
- doctor-side patient-info writes are mirrored back to sandbox for patient-record snapshot compatibility
- raw `fetch()` calls in doctor workflow are reduced in favor of typed API helpers
- no route directly owns long-lived SSE subscriber state
- boundary vocabularies such as `lab_report` and `ocr` are normalized before persistence

1. Commit.

```powershell
git add 1_core_orchestrator docs/architecture
git commit -m "refactor(workflow): stabilize patient doctor case and imaging state boundaries"
```

---

## Rollout Notes

- Do this plan in order. Task 5 depends on Task 2 service seams and Task 3 identity cleanup.
- Do not attempt Redis migration in the same change set as EventBus extraction.
- Keep `packages/harness/deerflow` free of imports from `app/`; use mirrored sandbox writes instead of crossing that boundary.
- Normalize boundary vocabularies (`lab_report`, `ocr`) in workflow services, not in the case domain model.
- If `uv sync` on Windows reports file-lock errors, stop LangGraph and Gateway processes before package churn.
- If report migration reveals legacy JSON rows without `report_id`, add a one-off repair script instead of baking fallback mutation into GET handlers.

## Success Criteria

- Importing `requests` stays warning-free in backend tests.
- `appointment.py`, `cases.py`, and `imaging_reports.py` become thin orchestration layers over services.
- `preview_appointment`, `schedule_appointment`, and `deerflow.patient_record_context` continue to work because sandbox files are mirrored on writes, not because GET handlers perform hidden sync.
- Distinct `case_id` and `patient_thread_id` values work for patient-confirmed and doctor-created cases without breaking uploads or patient status lookup.
- The frontend reuses the existing imaging API client instead of introducing a second DTO surface.
- Thread-based case lookup becomes explicit and deterministic.
- Doctor review updates no longer depend on GET-side file-to-DB sync.
- `EvidenceDesk.tsx` and `ImagingViewer.tsx` use typed API helpers rather than route-specific inline fetch paths.
- SSE implementation is no longer a route-local global list.
