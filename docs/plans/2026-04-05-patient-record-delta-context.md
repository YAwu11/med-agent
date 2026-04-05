# Patient Record Delta Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace per-turn full patient-record injection with a split model of persisted system notices plus source-aware hidden deltas, so patients see centered status bars immediately while the agent only receives meaningful updates after the current reply is safe to extend.

**Architecture:** Keep backend snapshot assembly in one place and add revisioned delta generation on top of it. Persist patient-visible system notices in thread values and render them as centered dividers anchored below the relevant assistant reply. Only patient manual field edits and completed upload analyses produce hidden context-event messages for the agent; agent-initiated field writes create notices only, while middleware remains a safety net for missed deltas. Before diagnosis, the lead agent must call a new read-only tool that returns the full patient record snapshot.

**Tech Stack:** FastAPI, Pydantic v2, pytest, LangGraph/deerflow, Next.js App Router, React, TypeScript, Vitest, EventSource.

---

## Scope

- In:
  - Add revisioned patient-record delta generation.
  - Stop injecting the full patient record block on every human turn.
  - Add a new read-only tool for full patient-record reads.
  - Emit upload lifecycle thread events for both processing and completed states.
  - Persist patient-visible `system_notices` in thread values.
  - Render system notices as centered non-bubble rows beneath the relevant assistant response.
  - Send hidden context-event messages from the chat page only for patient manual field edits and completed upload analyses.
  - Filter hidden context-event messages out of visible chat bubbles.
  - Expand patient-info write schema to match the canonical PatientInfo model.
  - Surface agent-initiated patient-info writes as success notices without sending a delta back to the agent.
  - Update prompt instructions and tests.
- Out:
  - Editing raw OCR text or raw imaging output.
  - Replacing the existing medical-record UI tool.
  - Building a doctor-only evidence-annotation workflow.

## Success Criteria

1. The agent no longer receives the full patient record on every new user turn.
2. Patient-visible system notices persist across refresh and render as centered divider rows rather than chat bubbles.
3. Manual patient field edits show only field names in the visible notice, not the edited values.
4. Completed lab-report or imaging analyses produce a visible “识别完成” notice and a hidden delta containing the recognized result.
5. Agent-initiated `update_patient_info` writes produce visible success notices only and do not send a delta back to the agent.
6. Visible chat bubbles do not show hidden context-event messages.
7. The lead agent prompt requires a full-record read before diagnosis or re-diagnosis.
8. The new full-record tool exposes the complete snapshot without mixing UI-only payload logic into agent reasoning.
9. `update_patient_info` can write all supported `PatientInfo` fields and return structured field-level change metadata.

### Task 1: Add Snapshot Revision and Delta Builder

**Files:**
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/patient_record_context.py`
- Test: `1_core_orchestrator/backend/tests/test_patient_record_context.py`

**Step 1: Write the failing delta tests**

Add tests for two new behaviors:

- snapshots include a monotonic `revision` and stable change surface
- deltas describe added uploads, status changes, field changes, and deletions

```python
def test_build_patient_record_delta_reports_upload_processing_to_completed(tmp_path):
    paths = _paths(tmp_path)
    _write_upload(paths, "cbc.png")
    _write_meta(paths, "cbc.png", {"image_type": "lab_report", "image_confidence": 0.98})

    before = build_patient_record_snapshot(THREAD_ID, paths=paths)

    _write_ocr(paths, "cbc.png", "# 血常规\n\n- 白细胞升高")
    after = build_patient_record_snapshot(THREAD_ID, paths=paths)

    delta = build_patient_record_delta(before, after)

    assert any(change["type"] == "upload_status_changed" for change in delta["changes"])
    assert any(change.get("summary") == "血常规\n- 白细胞升高" for change in delta["changes"])
```

**Step 2: Run the focused test to verify it fails**

Run from `1_core_orchestrator/backend`:

```powershell
PYTHONPATH=. uv run pytest tests/test_patient_record_context.py::test_build_patient_record_delta_reports_upload_processing_to_completed -v
```

Expected: FAIL because `build_patient_record_delta` and `revision` do not exist.

**Step 3: Implement the minimal delta builder**

In `patient_record_context.py`:

- add a `revision` field to the snapshot
- add `build_patient_record_delta(previous, current)`
- add `format_patient_record_delta_block(delta)`

Use compact change shapes like:

```python
{
    "type": "upload_added",
    "filename": "cbc.png",
    "category": "lab_report",
    "status": "processing",
}
```

and

```python
{
    "type": "upload_status_changed",
    "filename": "cbc.png",
    "from_status": "processing",
    "to_status": "completed",
    "summary": "白细胞升高",
}
```

**Step 4: Add field change coverage**

Extend the test file with cases for:

- `patient_info_added`
- `patient_info_updated`
- `patient_info_deleted`

**Step 5: Run the focused module**

```powershell
PYTHONPATH=. uv run pytest tests/test_patient_record_context.py -v
```

**Step 6: Commit**

```powershell
git add tests/test_patient_record_context.py packages/harness/deerflow/patient_record_context.py
git commit -m "feat: add patient record delta builder"
```

### Task 2: Convert Middleware to Delta Fallback Instead of Full Injection

**Files:**
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/agents/middlewares/patient_record_middleware.py`
- Test: `1_core_orchestrator/backend/tests/test_patient_record_context.py`

**Step 1: Write the failing middleware tests**

Add tests that assert:

- plain human turns no longer get a full `<patient_record>` block
- when snapshot revision changed and no explicit delta message was sent, middleware injects `<patient_record_delta>`
- when `additional_kwargs.context_event.kind == "patient_record_delta"`, middleware does nothing

```python
def test_middleware_backfills_delta_instead_of_full_snapshot(tmp_path):
    middleware = PatientRecordMiddleware(base_dir=str(tmp_path))
    ...
    result = middleware.before_agent({"messages": [HumanMessage(content="继续")]}, _runtime())
    assert "<patient_record_delta" in result["messages"][-1].content
    assert "<patient_record>" not in result["messages"][-1].content
```

**Step 2: Run the focused middleware tests**

```powershell
PYTHONPATH=. uv run pytest tests/test_patient_record_context.py -k middleware -v
```

Expected: FAIL because middleware still injects `<patient_record>`.

**Step 3: Implement the minimal middleware change**

In `patient_record_middleware.py`:

- keep `patient_record_snapshot` in state
- compare previous snapshot to current snapshot
- inject delta only when there are unseen changes
- skip injection when the incoming message already carries a `context_event` delta marker

**Step 4: Preserve message metadata**

Keep `id` and `additional_kwargs` unchanged when rebuilding the `HumanMessage`.

**Step 5: Run focused validation**

```powershell
PYTHONPATH=. uv run pytest tests/test_patient_record_context.py -k middleware -v
```

**Step 6: Commit**

```powershell
git add tests/test_patient_record_context.py packages/harness/deerflow/agents/middlewares/patient_record_middleware.py
git commit -m "refactor: use patient record delta fallback middleware"
```

### Task 3: Add a Full-Record Read Tool for Diagnosis

**Files:**
- Create: `1_core_orchestrator/backend/app/core/tools/builtins/read_patient_record.py`
- Modify: `1_core_orchestrator/backend/app/core/tools/tools.py`
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/tools/tools.py`
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/agents/lead_agent/prompt.py`
- Test: `1_core_orchestrator/backend/tests/test_registration_tool_contract.py`
- Test: `1_core_orchestrator/backend/tests/test_patient_record_context.py`

**Step 1: Write the failing tool contract test**

Add a test that verifies the builtin tool registry exposes `read_patient_record` and that it returns a structured snapshot with `patient_info`, `uploaded_items`, `evidence_items`, and `guidance`.

```python
def test_read_patient_record_is_registered_and_returns_snapshot(tmp_path):
    tool = next(tool for tool in get_all_builtin_tools() if tool.name == "read_patient_record")
    payload = asyncio.run(tool.ainvoke({"mode": "diagnosis"}, config={"configurable": {"thread_id": THREAD_ID}}))
    assert payload["thread_id"] == THREAD_ID
    assert "patient_info" in payload
    assert "guidance" in payload
```

**Step 2: Run the focused test to verify it fails**

```powershell
PYTHONPATH=. uv run pytest tests/test_registration_tool_contract.py -k read_patient_record -v
```

Expected: FAIL because the tool does not exist.

**Step 3: Implement the new tool**

Create `read_patient_record.py` with a small schema:

```python
class ReadPatientRecordSchema(BaseModel):
    mode: Literal["summary", "full", "diagnosis"] = "diagnosis"
```

Return the snapshot from `build_patient_record_snapshot`, optionally pruning fields for `summary`.

**Step 4: Register the tool and update the prompt**

In both tool registries:

- import and expose `read_patient_record`

In `lead_agent/prompt.py`:

- remove wording that depends on per-turn full injected patient record
- add an explicit instruction: call `read_patient_record` before diagnosis or re-diagnosis

**Step 5: Run focused validation**

```powershell
PYTHONPATH=. uv run pytest tests/test_registration_tool_contract.py tests/test_patient_record_context.py -v
```

**Step 6: Commit**

```powershell
git add app/core/tools/builtins/read_patient_record.py app/core/tools/tools.py packages/harness/deerflow/tools/tools.py packages/harness/deerflow/agents/lead_agent/prompt.py tests/test_registration_tool_contract.py tests/test_patient_record_context.py
git commit -m "feat: add read patient record diagnosis tool"
```

### Task 4: Align `update_patient_info` With Canonical `PatientInfo` and Return Notice Metadata

**Files:**
- Modify: `1_core_orchestrator/backend/app/core/tools/builtins/update_patient_info.py`
- Modify: `1_core_orchestrator/backend/tests/test_update_patient_info_tool.py`
- Modify: `1_core_orchestrator/backend/app/gateway/models/case.py` (only if a missing canonical field must be added there first)

**Step 1: Write the failing schema test**

Add regression tests for two behaviors:

- fields that exist in `PatientInfo` but are missing from the tool schema now, such as `phone`, `id_number`, `height_cm`, `weight_kg`, and `spo2`
- the tool returns structured field-level change metadata that the frontend can turn into “修改成功 / 新增成功 / 删除成功” notices

```python
def test_update_patient_info_accepts_extended_patient_fields(tmp_path):
    payload = {
        "phone": "13800138000",
        "id_number": "110101199001010011",
        "height_cm": 168,
        "weight_kg": 62,
        "spo2": "98%",
    }
    result = asyncio.run(update_patient_info_tool.ainvoke(payload, config=_tool_config(tmp_path)))
    assert result["updated_fields"]["phone"] == "13800138000"


  def test_update_patient_info_returns_field_change_actions(tmp_path):
    result = asyncio.run(
      update_patient_info_tool.ainvoke(
        {"chief_complaint": "胸痛 2 天", "allergies": None},
        config=_tool_config(tmp_path),
      )
    )
    assert {change["field"]: change["action"] for change in result["changes"]} == {
      "chief_complaint": "updated",
      "allergies": "deleted",
    }
```

**Step 2: Run the focused test to verify it fails**

```powershell
PYTHONPATH=. uv run pytest tests/test_update_patient_info_tool.py -k extended_patient_fields -v
```

Expected: FAIL because the schema rejects the new fields.

**Step 3: Implement the minimal schema expansion**

Update `UpdatePatientInfoSchema` to match the current canonical `PatientInfo` model and return field-level action metadata such as `added`, `updated`, and `deleted`.

**Step 4: Run the focused module**

```powershell
PYTHONPATH=. uv run pytest tests/test_update_patient_info_tool.py -v
```

**Step 5: Commit**

```powershell
git add app/core/tools/builtins/update_patient_info.py tests/test_update_patient_info_tool.py
git commit -m "feat: align update patient info schema with patient model"
```

### Task 5: Emit Upload Lifecycle Events for Processing and Completion

**Files:**
- Modify: `1_core_orchestrator/backend/app/gateway/routers/uploads.py`
- Modify: `1_core_orchestrator/backend/tests/test_uploads_router.py`
- Modify: `1_core_orchestrator/backend/app/gateway/services/thread_events.py` (only if helper support is needed)

**Step 1: Write the failing upload event test**

Add a test that asserts `upload_files()` publishes one `upload_received` event before analysis and one `upload_analyzed` event after analysis, with enough completion payload to build both a visible notice and a hidden AI delta.

```python
def test_upload_files_publish_received_and_analyzed_events(tmp_path):
    ...
    with patch.object(uploads, "publish_thread_event") as publish_thread_event:
        asyncio.run(uploads.upload_files("thread-analysis", BackgroundTasks(), files=[file]))

    event_types = [call.args[1]["type"] for call in publish_thread_event.call_args_list]
    assert event_types == ["upload_received", "upload_analyzed"]
```

**Step 2: Run the focused test to verify it fails**

```powershell
PYTHONPATH=. uv run pytest tests/test_uploads_router.py -k received_and_analyzed -v
```

Expected: FAIL because only `upload_analyzed` exists today.

**Step 3: Implement the minimal backend change**

In `uploads.py`:

- publish `upload_received` immediately after the file is persisted
- include `filename`, `upload_id` when known, `status`, and coarse category
- keep `upload_analyzed` for completion or failure

If necessary, normalize event-id generation in `thread_events.py` so both event types carry stable IDs.

**Step 4: Extend the completion payload**

Include summary fields needed to build a delta message without re-fetching the full record, for example:

- `status`
- `analysis_kind`
- `summary`
- `category`

The frontend policy will be:

- `upload_received`: visible notice only
- `upload_analyzed` with `status == completed`: visible notice + hidden AI delta
- `upload_analyzed` with `status == failed`: visible notice only in phase 1

**Step 5: Run focused validation**

```powershell
PYTHONPATH=. uv run pytest tests/test_uploads_router.py -v
```

**Step 6: Commit**

```powershell
git add app/gateway/routers/uploads.py app/gateway/services/thread_events.py tests/test_uploads_router.py
git commit -m "feat: emit upload lifecycle thread events"
```

### Task 6: Persist and Render Centered System Notices

**Files:**
- Modify: `1_core_orchestrator/frontend/src/core/threads/types.ts`
- Create: `1_core_orchestrator/frontend/src/core/patient/systemNotices.ts`
- Create: `1_core_orchestrator/frontend/src/core/patient/systemNotices.test.ts`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/messages/message-list.tsx`
- Create: `1_core_orchestrator/frontend/src/components/workspace/messages/system-notice-row.tsx`
- Create: `1_core_orchestrator/frontend/src/components/workspace/messages/__tests__/message-list-system-notices.test.tsx`

**Step 1: Write the failing system-notice helper tests**

Add tests for helpers that build visible notices from different sources:

- manual patient form edits show only field labels
- agent tool writes show success wording only
- upload received shows “上传了 xxx，识别中”
- upload analyzed completed shows “xxx 识别完成”

```typescript
it("builds a patient-visible field edit notice without values", () => {
  const notice = buildPatientFieldNotice({
    kind: "patient_info_updated",
    actions: [
      { field: "chief_complaint", action: "updated" },
      { field: "present_illness", action: "added" },
    ],
  });
  expect(notice.text).toContain("主诉");
  expect(notice.text).toContain("现病史");
  expect(notice.text).not.toContain("胸痛 2 天");
});
```

**Step 2: Write the failing render test**

Add a test that a persisted system notice renders as a centered divider row below the anchored assistant message and not as a chat bubble.

**Step 3: Run the focused tests to verify they fail**

Run from `1_core_orchestrator/frontend`:

```powershell
pnpm vitest run src/core/patient/systemNotices.test.ts src/components/workspace/messages/__tests__/message-list-system-notices.test.tsx
```

Expected: FAIL because `system_notices` and the row component do not exist.

**Step 4: Implement the system-notice state and row renderer**

In `types.ts`, extend `AgentThreadState` with a `system_notices` array.

In `systemNotices.ts`:

- define the persisted notice shape
- add helpers for manual patient edits, agent tool writes, upload received, and upload analyzed

In `message-list.tsx`:

- merge persisted notices into the rendered sequence by `anchor_message_id`
- render them with `SystemNoticeRow`

In `system-notice-row.tsx`:

- render a centered horizontal divider with concise system text
- avoid bubble styling entirely

**Step 5: Run focused validation**

```powershell
pnpm vitest run src/core/patient/systemNotices.test.ts src/components/workspace/messages/__tests__/message-list-system-notices.test.tsx
pnpm typecheck
```

**Step 6: Commit**

```powershell
git add src/core/threads/types.ts src/core/patient/systemNotices.ts src/core/patient/systemNotices.test.ts src/components/workspace/messages/message-list.tsx src/components/workspace/messages/system-notice-row.tsx src/components/workspace/messages/__tests__/message-list-system-notices.test.tsx
git commit -m "feat: persist and render centered system notices"
```

### Task 7: Support Hidden Context-Event Messages in the Frontend

**Files:**
- Modify: `1_core_orchestrator/frontend/src/core/messages/utils.ts`
- Create: `1_core_orchestrator/frontend/src/core/messages/utils.test.ts`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/messages/message-list-item.tsx`
- Modify: `1_core_orchestrator/frontend/src/core/threads/hooks.ts`

**Step 1: Write the failing message-filter tests**

Add tests for:

- `isHiddenContextEventMessage(message)` returns true for human messages carrying `additional_kwargs.context_event.hidden_in_ui === true`
- `groupMessages()` drops those messages from visible groups

```typescript
it("filters hidden patient-record delta messages", () => {
  const groups = groupMessages(
    [
      {
        type: "human",
        id: "ctx-1",
        content: "<patient_record_delta revision=\"2\">...</patient_record_delta>",
        additional_kwargs: {
          context_event: { kind: "patient_record_delta", hidden_in_ui: true },
        },
      },
    ],
    (group) => group,
  );
  expect(groups).toHaveLength(0);
});
```

**Step 2: Run the focused test to verify it fails**

Run from `1_core_orchestrator/frontend`:

```powershell
pnpm vitest run src/core/messages/utils.test.ts
```

Expected: FAIL because no hidden-context helper exists.

**Step 3: Implement the minimal frontend filter**

In `utils.ts`:

- add `isHiddenContextEventMessage(message)`
- skip those messages near the top of `groupMessages()`

No rendering logic should be needed in `message-list-item.tsx` once the grouping layer filters correctly, but keep a defensive guard there if useful.

**Step 4: Extend `sendMessage` support for extra message kwargs**

In `threads/hooks.ts`, add an optional `extraAdditionalKwargs` or equivalent parameter so callers can send hidden context-event messages without duplicating thread submission logic.

**Step 5: Run focused validation**

```powershell
pnpm vitest run src/core/messages/utils.test.ts
pnpm typecheck
```

**Step 6: Commit**

```powershell
git add src/core/messages/utils.ts src/core/messages/utils.test.ts src/core/threads/hooks.ts src/components/workspace/messages/message-list-item.tsx
git commit -m "feat: support hidden context-event chat messages"
```

### Task 8: Send Source-Aware Patient-Record Updates From the Chat Page

**Files:**
- Modify: `1_core_orchestrator/frontend/src/core/api/thread-events.ts`
- Modify: `1_core_orchestrator/frontend/src/core/api/thread-events.test.ts`
- Modify: `1_core_orchestrator/frontend/src/app/workspace/chats/[thread_id]/page.tsx`
- Create: `1_core_orchestrator/frontend/src/core/patient/patientRecordDeltaEvents.ts`
- Create: `1_core_orchestrator/frontend/src/core/patient/patientRecordDeltaEvents.test.ts`
- Modify: `1_core_orchestrator/frontend/src/core/threads/hooks.ts`

**Step 1: Write the failing event parser test**

Extend `thread-events.test.ts` to accept both `upload_received` and richer `upload_analyzed` payloads.

```typescript
it("accepts upload_received events", () => {
  expect(
    parseThreadEventData(
      JSON.stringify({
        type: "upload_received",
        thread_id: "thread-1",
        event_id: "evt-1",
        filename: "cbc.png",
        category: "lab_report",
        status: "processing",
      }),
    ),
  ).toEqual({
    type: "upload_received",
    thread_id: "thread-1",
    event_id: "evt-1",
    filename: "cbc.png",
    category: "lab_report",
    status: "processing",
  });
});
```

**Step 2: Write the failing delta-message and notice-dispatch helper tests**

In `patientRecordDeltaEvents.test.ts`, add tests for helpers that convert source events into hidden context messages only when policy allows it.

```typescript
it("builds a hidden upload analyzed delta message only for completed analyses", () => {
  const message = buildUploadDeltaMessage({
    type: "upload_analyzed",
    thread_id: "thread-1",
    event_id: "evt-1",
    filename: "cbc.png",
    category: "lab_report",
    status: "completed",
    summary: "白细胞升高",
  });
  expect(message.text).toContain("cbc.png");
  expect(message.additional_kwargs?.context_event?.hidden_in_ui).toBe(true);
});
```

Also add a test that agent-initiated `update_patient_info` write notices do not produce a hidden delta.

**Step 3: Run the focused tests to verify they fail**

```powershell
pnpm vitest run src/core/api/thread-events.test.ts src/core/patient/patientRecordDeltaEvents.test.ts
```

Expected: FAIL because the new event type and helper module do not exist.

**Step 4: Implement the parser and delta helpers**

In `thread-events.ts`:

- add `UploadReceivedThreadEvent`
- extend `ThreadEvent`
- parse new summary/category/status fields

In `patientRecordDeltaEvents.ts`:

- add `buildUploadDeltaMessage(event)`
- add `buildPatientInfoDeltaMessage(...)` for patient manual edits
- add policy helpers such as `shouldSendDeltaForEvent(source)`

**Step 5: Update the chat page**

In `[thread_id]/page.tsx`:

- stop sending visible normal chat bubbles for these record-sync events
- persist `system_notices` into thread state before any AI delta send attempt
- queue hidden deltas when `thread.isLoading` or `isUploading` is true
- flush queued deltas after the current AI reply completes
- keep de-duplication by `event_id` and tool-call identifier

Apply this source policy:

- manual patient form save: system notice + hidden delta
- upload received: system notice only
- upload analyzed completed: system notice + hidden delta
- upload analyzed failed: system notice only
- agent `update_patient_info` success: system notice only

Also update `handlePatientInfoSaved` to write a system notice with field names only and send a hidden patient-info delta with actual values.

**Step 6: Run focused validation**

```powershell
pnpm vitest run src/core/api/thread-events.test.ts src/core/patient/patientRecordDeltaEvents.test.ts
pnpm typecheck
```

**Step 7: Commit**

```powershell
git add src/core/api/thread-events.ts src/core/api/thread-events.test.ts src/core/patient/patientRecordDeltaEvents.ts src/core/patient/patientRecordDeltaEvents.test.ts src/app/workspace/chats/[thread_id]/page.tsx
git commit -m "feat: send hidden patient record delta messages"
```

### Task 9: Run Full Targeted Verification and Update Docs

**Files:**
- Modify: `1_core_orchestrator/backend/README.md` or the closest backend doc if tool behavior docs need syncing
- Modify: `docs/plans/2026-04-05-patient-record-delta-context-design.md` only if implementation deviated from the design

**Step 1: Run backend targeted verification**

Run from `1_core_orchestrator/backend`:

```powershell
PYTHONPATH=. uv run pytest tests/test_patient_record_context.py tests/test_update_patient_info_tool.py tests/test_registration_tool_contract.py tests/test_uploads_router.py -v
```

Expected: PASS.

**Step 2: Run frontend targeted verification**

Run from `1_core_orchestrator/frontend`:

```powershell
pnpm vitest run src/core/patient/systemNotices.test.ts src/components/workspace/messages/__tests__/message-list-system-notices.test.tsx src/core/messages/utils.test.ts src/core/api/thread-events.test.ts src/core/patient/patientRecordDeltaEvents.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 3: Sync documentation**

Update the nearest backend/frontend docs if the final event names, tool names, or prompt contract differs from the current docs.

**Step 4: Commit**

```powershell
git add docs/plans/2026-04-05-patient-record-delta-context-design.md 1_core_orchestrator/backend/README.md
git commit -m "docs: document patient record delta context flow"
```
