# Patient Record Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the AI receive current patient form and upload-summary context on every new chat turn, split chat and medical-record UI entry points cleanly, and gate synthesis until the record is ready.

**Architecture:** Add a shared patient snapshot builder in the backend harness layer, inject its text summary through a dedicated middleware on every human turn, and reuse the same snapshot in medical-record APIs. On the frontend, downgrade the inline chat medical-record card to a light notice, add an independent upload entry inside the medical-record dialog, and surface readiness and guidance from the shared snapshot.

**Tech Stack:** Python, FastAPI, LangGraph middleware, Next.js 16, React 19, TypeScript, Tailwind CSS.

**Implementation Status (2026-04-04):**
- Done: shared patient snapshot builder, per-turn patient-record middleware injection, prompt gating, shared medical-record API/tool reuse, doctor-side synthesis readiness gate, chat light notice, dialog-local upload entry, patient guidance UI.
- Verification run: `pytest tests/test_patient_record_context.py -v`, `pnpm typecheck`, `pnpm exec eslint "src/components/workspace/messages/message-list-item.tsx" "src/components/workspace/MedicalRecordCard.tsx" "src/components/workspace/MedicalRecordDrawer.tsx" "src/components/workspace/welcome.tsx" "src/app/workspace/chats/[thread_id]/page.tsx" "src/core/api/cases.ts"`.
- Note: `EvidenceDesk.tsx` still carries unrelated historical lint debt; the updated patient-workflow files above lint clean in isolation.

---

### Task 1: Add failing backend tests for patient snapshot and middleware

**Files:**
- Create: `1_core_orchestrator/backend/tests/test_patient_record_context.py`
- Modify: `1_core_orchestrator/backend/tests/test_uploads_middleware_core_logic.py`

**Step 1: Write the failing tests**
- Add tests for shared patient snapshot generation from `patient_intake.json`, upload sidecars, imaging reports, and pending uploads.
- Add tests for a new patient-record middleware that injects a `<patient_record>` block while preserving message metadata.

**Step 2: Run tests to verify they fail**
- Run: `pytest tests/test_patient_record_context.py -v`
- Expected: fail because the snapshot builder and middleware do not exist yet.

### Task 2: Implement shared patient snapshot builder in harness layer

**Files:**
- Create: `1_core_orchestrator/backend/packages/harness/deerflow/patient_record_context.py`

**Step 1: Write minimal implementation**
- Add pure helpers to read patient intake, upload metadata sidecars, OCR summaries, imaging report summaries, and pending upload state from thread directories.
- Return a unified snapshot including `patient_info`, `evidence_items`, uploaded-summary items, and readiness/guidance fields.

**Step 2: Run targeted tests**
- Run: `pytest tests/test_patient_record_context.py -v`

### Task 3: Inject patient snapshot into every human turn

**Files:**
- Create: `1_core_orchestrator/backend/packages/harness/deerflow/agents/middlewares/patient_record_middleware.py`
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/agents/middlewares/tool_error_handling_middleware.py`
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/agents/lead_agent/prompt.py`

**Step 1: Add middleware**
- Prepend a compact `<patient_record>` block on each human turn when thread snapshot data exists.
- Preserve `additional_kwargs` so existing file rendering remains intact.

**Step 2: Update prompt policy**
- Explicitly instruct the patient-side AI to avoid comprehensive judgement when the snapshot says uploads are still processing or required record fields are missing.

**Step 3: Run tests**
- Run: `pytest tests/test_patient_record_context.py tests/test_uploads_middleware_core_logic.py -v`

### Task 4: Reuse snapshot in medical-record APIs and tool outputs

**Files:**
- Modify: `1_core_orchestrator/backend/app/core/tools/builtins/show_medical_record.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/appointment.py`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/cases.py`

**Step 1: Replace duplicated record-building logic**
- Use the shared snapshot builder for `show_medical_record` and `GET /medical-record`.

**Step 2: Add readiness metadata**
- Extend summary endpoints or summary gate logic so synthesis reports readiness, blocking reasons, and pending items.

**Step 3: Run backend tests**
- Run: `pytest tests/test_patient_record_context.py tests/test_uploads_router.py -v`

### Task 5: Split chat and medical-record presentation on the frontend

**Files:**
- Modify: `1_core_orchestrator/frontend/src/components/workspace/messages/message-list-item.tsx`
- Modify: `1_core_orchestrator/frontend/src/app/workspace/chats/[thread_id]/page.tsx`

**Step 1: Replace inline full card**
- Render a light medical-record notice in chat instead of the full editable card.
- Keep the page-level dialog as the primary medical-record workspace.

**Step 2: Fix header button layout**
- Ensure the `病历单` trigger stays on one line with stable spacing.

### Task 6: Add independent upload and richer guidance inside the medical record

**Files:**
- Modify: `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordCard.tsx`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordDrawer.tsx`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/welcome.tsx`
- Modify: `1_core_orchestrator/frontend/src/core/api/cases.ts`

**Step 1: Add dialog-local upload entry**
- Reuse the existing upload API from the medical-record dialog without sending a new chat message.

**Step 2: Surface guidance**
- Show progress, missing required fields, pending uploads, next action hints, and upload tips in the welcome state and record dialog.

**Step 3: Connect synthesis readiness**
- Disable or guard synthesis actions based on readiness metadata.

### Task 7: Update docs and verify end-to-end

**Files:**
- Modify: `1_core_orchestrator/backend/CLAUDE.md`
- Modify: `1_core_orchestrator/frontend/CLAUDE.md`
- Modify: `1_core_orchestrator/frontend/README.md`

**Step 1: Update docs**
- Document the new patient snapshot injection and the medical-record upload/guidance workflow.

**Step 2: Run verification**
- Backend: `pytest tests/test_patient_record_context.py tests/test_uploads_middleware_core_logic.py tests/test_uploads_router.py -v`
- Frontend: `pnpm typecheck`
- Frontend targeted lint: `pnpm exec eslint "src/components/workspace/MedicalRecordCard.tsx" "src/components/workspace/MedicalRecordDrawer.tsx" "src/components/workspace/messages/message-list-item.tsx" "src/app/workspace/chats/[thread_id]/page.tsx" "src/components/workspace/welcome.tsx"`