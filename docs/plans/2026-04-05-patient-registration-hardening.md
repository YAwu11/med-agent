# Patient Registration Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete and harden the patient-side registration flow so confirmed patient data is preserved, field names are canonical end-to-end, AI notifications originate from the correct UI and event owners, and lightweight field audit metadata stays out of model context.

**Architecture:** Keep a single registration path: the agent can only generate an appointment preview, and the patient completes formal registration through the gateway confirmation endpoint. Patient-entered data remains in `patient_intake.json` using canonical keys plus `_field_meta`, but `_field_meta` is filtered before patient context is injected into the agent. All AI-triggering side effects are owned by the chat page, while background upload analysis completion is delivered through a thread-scoped SSE channel with client-side idempotent deduplication.

**Tech Stack:** FastAPI, Pydantic v2, pytest, Next.js App Router, React, Vitest, EventSource, LangGraph/deerflow.

---

## Scope

- In:
  - Fix the confirmation-time patient info data-loss bug.
  - Canonicalize patient info keys across backend, preview UI, and medical-record UI.
  - Switch patient form saves to diff-only PATCH requests.
  - Send one AI nudge after successful patient form save from the chat-page owner.
  - Add `_field_meta` write and filtering behavior.
  - Remove `schedule_appointment` from active agent tool paths.
  - Add a thread-scoped upload-analysis SSE channel with deduped AI nudges.
  - Add backend and frontend regression coverage for the above.
- Out:
  - Doctor-side provenance UI.
  - Full audit-history timelines beyond last-writer metadata.
  - Persistence of SSE dedupe state across full browser restarts.
  - Reworking `app/engine/patient_graph.py`, which is already marked non-production.

## Success Criteria

1. Confirming registration preserves all valid `PatientInfo` fields in both the created case and the saved intake snapshot.
2. The patient preview UI, medical-record UI, and backend schema all use `medical_history` and `allergies`, never `past_history` or `allergy_history`.
3. Saving the patient form sends only changed fields to `PATCH /patient-intake` and triggers at most one AI nudge per save.
4. `_field_meta` is written for patient and agent edits but never appears in agent prompt context.
5. The agent can no longer formally register a patient via `schedule_appointment`; it can only preview.
6. Upload analysis completion can trigger exactly one patient-chat AI nudge per analyzed upload event.

### Task 1: Fix Confirmation-Time Patient Info Loss

**Files:**
- Modify: `1_core_orchestrator/backend/app/gateway/routers/appointment.py`
- Test: `1_core_orchestrator/backend/tests/test_appointment_router.py`

**Step 1: Write the failing test**

Add a regression test that posts to `POST /api/threads/{thread_id}/confirm-appointment`, captures the `Case` passed into `create_case`, and asserts that `name`, `age`, and `chief_complaint` are preserved.

```python
def test_confirm_appointment_preserves_patient_info_fields(tmp_path: Path):
    captured_case_requests = []

    def _capture_create_case(case: Case):
        captured_case_requests.append(case)
        return case

    ...
    response = client.post(
        f"/api/threads/{thread_id}/confirm-appointment",
        json={
            "patient_info": {
                "name": "张三",
                "age": 45,
                "chief_complaint": "胸痛 2 天",
            },
            "selected_evidence_ids": [],
            "priority": "medium",
        },
    )

    assert response.status_code == 200
    assert captured_case_requests[0].patient_info.name == "张三"
    assert captured_case_requests[0].patient_info.age == 45
    assert captured_case_requests[0].patient_info.chief_complaint == "胸痛 2 天"
```

**Step 2: Run the test to verify it fails**

Run from `1_core_orchestrator/backend`:

```powershell
PYTHONPATH=. uv run pytest tests/test_appointment_router.py::test_confirm_appointment_preserves_patient_info_fields -v
```

Expected: FAIL because the current `hasattr(PatientInfo, key)` filter drops every valid field under Pydantic v2.

**Step 3: Write the minimal implementation**

In `confirm_appointment`:

- Replace `hasattr(PatientInfo, key)` with `key in PatientInfo.model_fields`.
- Preserve `value is not None` filtering.
- Reuse the validated patient-info payload when writing back to `patient_intake.json` so the intake snapshot matches the created `Case`.

**Step 4: Extend the regression to the saved intake file**

Add assertions that the saved `patient_intake.json` contains the same canonical fields after confirmation.

**Step 5: Run focused validation**

```powershell
PYTHONPATH=. uv run pytest tests/test_appointment_router.py -v
```

**Step 6: Commit**

```powershell
git add tests/test_appointment_router.py app/gateway/routers/appointment.py
git commit -m "fix: preserve patient info on appointment confirmation"
```

### Task 2: Canonicalize Patient Info Keys Across Patient UI

**Files:**
- Create: `1_core_orchestrator/frontend/src/core/patient/patientInfoSchema.ts`
- Test: `1_core_orchestrator/frontend/src/core/patient/patientInfoSchema.test.ts`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/AppointmentPreview.tsx`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordCard.tsx`

**Step 1: Write the failing frontend schema test**

Add a Vitest unit test that asserts the shared patient schema includes `medical_history` and `allergies`, and explicitly does not include `past_history` or `allergy_history`.

```typescript
import { PATIENT_INFO_FIELDS } from "./patientInfoSchema";

it("uses canonical medical history keys", () => {
  const keys = PATIENT_INFO_FIELDS.map((field) => field.key);
  expect(keys).toContain("medical_history");
  expect(keys).toContain("allergies");
  expect(keys).not.toContain("past_history");
  expect(keys).not.toContain("allergy_history");
});
```

**Step 2: Run the test to verify it fails**

Run from `1_core_orchestrator/frontend`:

```powershell
pnpm vitest run src/core/patient/patientInfoSchema.test.ts
```

Expected: FAIL because the schema file does not exist yet.

**Step 3: Create the shared schema module**

Export a single source of truth for:

- canonical key names
- display labels
- placeholders
- field grouping used by the preview and the medical-record form

At minimum include:

```typescript
export const PATIENT_INFO_FIELDS = [
  { key: "name", label: "姓名" },
  { key: "age", label: "年龄" },
  { key: "sex", label: "性别" },
  { key: "chief_complaint", label: "主诉" },
  { key: "present_illness", label: "现病史" },
  { key: "medical_history", label: "既往史" },
  { key: "allergies", label: "过敏与用药" },
  ...
];
```

**Step 4: Replace hard-coded preview keys**

In `AppointmentPreview.tsx`:

- remove the stale `past_history` and `allergy_history` entries
- render the preview form from `PATIENT_INFO_FIELDS`
- keep any preview-only ordering logic in the shared schema rather than in component-local arrays

In `MedicalRecordCard.tsx`:

- replace duplicated labels and field-name literals where practical with imports from `patientInfoSchema.ts`
- do not rename backend payload keys in the component

**Step 5: Run frontend validation**

```powershell
pnpm vitest run src/core/patient/patientInfoSchema.test.ts
pnpm typecheck
```

**Step 6: Commit**

```powershell
git add src/core/patient/patientInfoSchema.ts src/core/patient/patientInfoSchema.test.ts src/components/workspace/AppointmentPreview.tsx src/components/workspace/MedicalRecordCard.tsx
git commit -m "refactor: unify patient info field schema"
```

### Task 3: Switch Patient Form Saves to Diff-Only PATCH and Correct AI-Nudge Ownership

**Files:**
- Create: `1_core_orchestrator/frontend/src/core/patient/patientInfoUpdates.ts`
- Test: `1_core_orchestrator/frontend/src/core/patient/patientInfoUpdates.test.ts`
- Create: `1_core_orchestrator/frontend/src/components/workspace/__tests__/MedicalRecordCard.test.tsx`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordCard.tsx`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordDrawer.tsx`
- Modify: `1_core_orchestrator/frontend/src/app/workspace/chats/[thread_id]/page.tsx`

**Step 1: Write the failing helper tests**

Add unit tests for two pure helpers:

- `computeDirtyFields(saved, edited)` returns only changed keys
- `buildPatientUpdateMessage(dirtyFields, labels)` returns a readable Chinese summary and omits blank values

```typescript
it("returns only changed fields", () => {
  expect(
    computeDirtyFields(
      { name: "张三", age: 45, chief_complaint: "胸痛" },
      { name: "张三", age: 46, chief_complaint: "胸痛" },
    ),
  ).toEqual({ age: 46 });
});
```

**Step 2: Write the failing component test**

Add a `MedicalRecordCard` test that mocks `fetch` and asserts:

- the PATCH body contains only changed fields
- `onPatientInfoSaved` is called only after a successful response
- no callback is fired when there is no diff

**Step 3: Run the tests to verify they fail**

```powershell
pnpm vitest run src/core/patient/patientInfoUpdates.test.ts src/components/workspace/__tests__/MedicalRecordCard.test.tsx
```

Expected: FAIL because the helpers and callback wiring do not exist yet.

**Step 4: Implement the helper module**

In `patientInfoUpdates.ts`, export:

- `computeDirtyFields`
- `buildPatientUpdateMessage`
- a normalization helper that treats `null`, empty string, and whitespace consistently

**Step 5: Update `MedicalRecordCard.tsx`**

- compute the diff before sending the PATCH request
- send only the diff body to `PATCH /api/threads/{thread_id}/patient-intake`
- add an optional `onPatientInfoSaved?: (message: string) => Promise<void>` prop
- call the callback only after the backend save succeeds and only if `buildPatientUpdateMessage` returns non-empty content

**Step 6: Thread the callback through the correct owners**

In `MedicalRecordDrawer.tsx`:

- accept `onPatientInfoSaved`
- pass it through to `MedicalRecordCard`

In `src/app/workspace/chats/[thread_id]/page.tsx`:

- own the callback
- use the existing `sendMessage(threadId, text)` function returned by `useThreadStream`
- keep all AI-triggering behavior at the page boundary

Do **not** wire `sendMessage` into `message-list-item.tsx`; that component is only a message renderer in the current architecture.

**Step 7: Run frontend validation**

```powershell
pnpm vitest run src/core/patient/patientInfoUpdates.test.ts src/components/workspace/__tests__/MedicalRecordCard.test.tsx
pnpm lint
pnpm typecheck
```

**Step 8: Commit**

```powershell
git add src/core/patient/patientInfoUpdates.ts src/core/patient/patientInfoUpdates.test.ts src/components/workspace/__tests__/MedicalRecordCard.test.tsx src/components/workspace/MedicalRecordCard.tsx src/components/workspace/MedicalRecordDrawer.tsx src/app/workspace/chats/[thread_id]/page.tsx
git commit -m "feat: send diff-based patient form updates to chat"
```

### Task 4: Add `_field_meta` Without Polluting Agent Context

**Files:**
- Modify: `1_core_orchestrator/backend/app/core/tools/builtins/update_patient_info.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/appointment.py`
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/patient_record_context.py`
- Create: `1_core_orchestrator/backend/tests/test_update_patient_info_tool.py`
- Modify: `1_core_orchestrator/backend/tests/test_appointment_router.py`
- Modify: `1_core_orchestrator/backend/tests/test_patient_record_context.py`

**Step 1: Write the failing backend tests**

Add regressions for three behaviors:

1. `update_patient_info` writes `_field_meta[key] = {source: "agent", updated_at: ...}`.
2. `PATCH /patient-intake` writes `_field_meta[key] = {source: "patient", updated_at: ...}`.
3. `_load_patient_info()` returns patient fields without `_field_meta`.

**Step 2: Run the tests to verify they fail**

```powershell
PYTHONPATH=. uv run pytest tests/test_update_patient_info_tool.py tests/test_appointment_router.py tests/test_patient_record_context.py -v
```

Expected: FAIL because metadata is not written or filtered yet.

**Step 3: Implement metadata writes in both write paths**

In `update_patient_info.py` and `appointment.py`:

- initialize `_field_meta` if absent
- stamp `source` and `updated_at` for each written field
- skip `_field_meta` itself when iterating updates

**Step 4: Handle deletions cleanly**

When a field is removed because the incoming value is blank or `None`, also remove its entry from `_field_meta` so metadata does not linger for deleted fields.

**Step 5: Preserve metadata during confirmation**

When `confirm_appointment` rewrites `patient_intake.json`, merge the canonical patient-info payload with the existing `_field_meta` block instead of clobbering the entire file.

**Step 6: Filter metadata before agent injection**

In `patient_record_context.py`:

- read the JSON
- `pop("_field_meta", None)` before returning the patient info payload

**Step 7: Run focused validation**

```powershell
PYTHONPATH=. uv run pytest tests/test_update_patient_info_tool.py tests/test_appointment_router.py tests/test_patient_record_context.py -v
```

**Step 8: Commit**

```powershell
git add app/core/tools/builtins/update_patient_info.py app/gateway/routers/appointment.py packages/harness/deerflow/patient_record_context.py tests/test_update_patient_info_tool.py tests/test_appointment_router.py tests/test_patient_record_context.py
git commit -m "feat: add patient field metadata without prompt leakage"
```

### Task 5: Collapse to a Single Registration Path

**Files:**
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/tools/tools.py`
- Modify: `1_core_orchestrator/backend/app/core/tools/tools.py`
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/agents/lead_agent/prompt.py`
- Modify: `1_core_orchestrator/backend/app/core/tools/builtins/update_patient_info.py`
- Modify: `1_core_orchestrator/backend/app/core/tools/builtins/save_analysis_result.py`
- Create: `1_core_orchestrator/backend/tests/test_registration_tool_contract.py`

**Step 1: Write the failing contract test**

Add a test that imports both tool registries and asserts:

- `preview_appointment_tool` is present
- `schedule_appointment_tool` is not present in any active builtin tool list

```python
def test_schedule_appointment_not_exposed_in_builtin_tools():
    from app.core.tools.tools import BUILTIN_TOOLS as app_tools
    from packages.harness.deerflow.tools.tools import BUILTIN_TOOLS as harness_tools

    names = {tool.name for tool in app_tools} | {tool.name for tool in harness_tools}
    assert "preview_appointment" in names
    assert "schedule_appointment" not in names
```

**Step 2: Run the test to verify it fails**

```powershell
PYTHONPATH=. uv run pytest tests/test_registration_tool_contract.py -v
```

Expected: FAIL because `schedule_appointment` is still registered today.

**Step 3: Remove the tool from active registries**

- remove the import and list entry from both builtin tool registries
- leave the module file on disk for rollback, but do not expose it to the agent runtime

**Step 4: Update prompts and stale user-facing references**

In the lead-agent prompt and related tool docstrings:

- replace “preview then schedule_appointment” with “preview then patient confirms in UI”
- keep the formal submission responsibility on the gateway endpoint only

**Step 5: Run contract validation**

```powershell
PYTHONPATH=. uv run pytest tests/test_registration_tool_contract.py -v
```

**Step 6: Commit**

```powershell
git add packages/harness/deerflow/tools/tools.py app/core/tools/tools.py packages/harness/deerflow/agents/lead_agent/prompt.py app/core/tools/builtins/update_patient_info.py app/core/tools/builtins/save_analysis_result.py tests/test_registration_tool_contract.py
git commit -m "refactor: remove agent-exposed scheduling path"
```

### Task 6: Add Thread-Scoped Upload-Analysis Events and Idempotent AI Nudges

**Files:**
- Create: `1_core_orchestrator/backend/app/gateway/services/thread_events.py`
- Create: `1_core_orchestrator/backend/app/gateway/routers/thread_events.py`
- Modify: `1_core_orchestrator/backend/app/gateway/app.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/uploads.py`
- Create: `1_core_orchestrator/backend/tests/test_thread_events_router.py`
- Modify: `1_core_orchestrator/backend/tests/test_uploads_router.py`
- Create: `1_core_orchestrator/frontend/src/core/api/thread-events.ts`
- Create: `1_core_orchestrator/frontend/src/core/api/thread-events.test.ts`
- Modify: `1_core_orchestrator/frontend/src/app/workspace/chats/[thread_id]/page.tsx`

**Step 1: Write the failing backend event test**

Add a router or service-level test that subscribes to `/api/threads/{thread_id}/events`, publishes a sample event, and asserts the stream emits:

```json
{
  "type": "upload_analyzed",
  "thread_id": "thread-1",
  "event_id": "upload-123:2026-04-05T12:00:00Z",
  "upload_id": "upload-123",
  "filename": "cbc.png",
  "analysis_kind": "ocr"
}
```

**Step 2: Extend uploads coverage with the failing publish assertion**

Add a test in `test_uploads_router.py` that verifies the upload-analysis path calls `publish_thread_event(...)` once analysis completes.

**Step 3: Run backend tests to verify they fail**

```powershell
PYTHONPATH=. uv run pytest tests/test_thread_events_router.py tests/test_uploads_router.py -v
```

Expected: FAIL because the service, router, and publish call do not exist yet.

**Step 4: Implement the backend event channel**

In `thread_events.py` service:

- keep a thread-id keyed in-memory subscriber registry
- provide `publish_thread_event(thread_id, event)` and an async generator for listeners

In `routers/thread_events.py`:

- expose `GET /api/threads/{thread_id}/events`
- stream SSE events for that thread only

In `app.py`:

- include the new router in `create_app()`

In `uploads.py`:

- publish `upload_analyzed` after OCR or imaging analysis completes and files are persisted
- include a stable `event_id` built from `upload_id` plus completion timestamp or analysis version

**Step 5: Write the failing frontend event-consumer test**

Add a unit test for `src/core/api/thread-events.ts` that verifies the event parser accepts `upload_analyzed` messages and ignores malformed payloads.

**Step 6: Implement frontend subscription and dedupe**

In `page.tsx`:

- subscribe to `/api/threads/{thread_id}/events` on mount
- maintain `seenEventIdsRef = new Set<string>()`
- call `sendMessage(threadId, text)` only when an incoming `event_id` has not been seen before
- format the auto-generated message as a patient-side update, for example: “我刚上传的检查材料《cbc.png》已经完成分析，请结合结果继续判断。”

Keep dedupe state in memory for the current page session only. Cross-refresh persistence is out of scope for this change.

**Step 7: Run validation**

```powershell
PYTHONPATH=. uv run pytest tests/test_thread_events_router.py tests/test_uploads_router.py -v
pnpm vitest run src/core/api/thread-events.test.ts
pnpm typecheck
```

**Step 8: Commit**

```powershell
git add app/gateway/services/thread_events.py app/gateway/routers/thread_events.py app/gateway/app.py app/gateway/routers/uploads.py tests/test_thread_events_router.py tests/test_uploads_router.py ../frontend/src/core/api/thread-events.ts ../frontend/src/core/api/thread-events.test.ts ../frontend/src/app/workspace/chats/[thread_id]/page.tsx
git commit -m "feat: notify patient chat when upload analysis completes"
```

### Task 7: End-to-End Validation and Documentation Cleanup

**Files:**
- Modify: `implementation_plan.md`
- Modify: `docs/CODE_CHANGE_SUMMARY_BY_FILE.md` (only if this repo keeps it current during feature delivery)

**Step 1: Run the focused backend regression suite**

From `1_core_orchestrator/backend`:

```powershell
PYTHONPATH=. uv run pytest tests/test_appointment_router.py tests/test_update_patient_info_tool.py tests/test_patient_record_context.py tests/test_registration_tool_contract.py tests/test_thread_events_router.py tests/test_uploads_router.py -v
```

**Step 2: Run the focused frontend regression suite**

From `1_core_orchestrator/frontend`:

```powershell
pnpm vitest run src/core/patient/patientInfoSchema.test.ts src/core/patient/patientInfoUpdates.test.ts src/components/workspace/__tests__/MedicalRecordCard.test.tsx src/core/api/thread-events.test.ts
pnpm lint
pnpm typecheck
```

**Step 3: Run a manual smoke test**

Verify the full patient flow manually:

1. Open a patient chat thread.
2. Update two patient fields and click save.
3. Confirm the network request body contains only the changed fields.
4. Confirm exactly one AI reply appears after the save-triggered nudge.
5. Open the appointment preview and verify canonical fields are shown.
6. Confirm the appointment and verify patient info persists correctly.
7. Upload a file, wait for analysis, and verify exactly one upload-analysis nudge reaches the chat.

**Step 4: Replace the outdated plan text**

Update `implementation_plan.md` so it no longer recommends:

- wiring AI form updates through `message-list-item.tsx`
- continuing to expose `schedule_appointment`
- adding `_field_meta` without a prompt-filtering step

**Step 5: Commit the docs sync**

```powershell
git add implementation_plan.md docs/CODE_CHANGE_SUMMARY_BY_FILE.md
git commit -m "docs: sync patient registration implementation plan"
```

## Open Questions

- Should `schedule_appointment.py` remain in the repository as a dormant fallback, or should it be fully removed after this migration proves stable?
- Do we want upload-analysis auto-nudges to use a dedicated system-message transport later, or is patient-style text via `sendMessage()` acceptable for this milestone?
- Should `_field_meta.updated_at` use UTC `Z` timestamps everywhere, or should it match the existing backend timestamp format if another convention already exists?

## Recommended Execution Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7

This order fixes the active data-loss bug first, then locks the schema contract, then layers side effects and eventing on top of a stable registration core.