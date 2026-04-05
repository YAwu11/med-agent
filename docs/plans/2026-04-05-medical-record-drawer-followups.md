# Medical Record Drawer Follow-ups Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the patient medical-record drawer so it opens without a blocking blank state, groups the save/reset/refresh actions with the reload button, and shows patient-save system notices in the visible chat area immediately.

**Architecture:** Keep the backend unchanged because the measured medical-record and uploads-list endpoints are already fast. Fix the behavior in the frontend by prefetching/caching the medical-record payload in the drawer, delegating the card action buttons to the drawer header in dialog mode, and changing patient-save notices to use a thread-tail anchor so they render at the bottom of the chat instead of being hidden under older assistant messages.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Testing Library.

---

### Task 1: Lock the Notice Visibility Regression

**Files:**
- Modify: `1_core_orchestrator/frontend/src/app/workspace/chats/[thread_id]/page.orchestration.test.ts`
- Modify: `1_core_orchestrator/frontend/src/core/patient/systemNotices.test.ts`

**Step 1: Write the failing tests**

- Assert patient form notices use a thread-tail anchor instead of the previous assistant message id.
- Assert thread-tail notices can be selected separately from message-anchored notices.

**Step 2: Run focused tests to verify they fail**

Run from `1_core_orchestrator/frontend`:

```powershell
pnpm test -- --run src/app/workspace/chats/[thread_id]/page.orchestration.test.ts src/core/patient/systemNotices.test.ts
```

**Step 3: Implement the minimal helper changes**

- Add a shared thread-tail anchor constant.
- Make patient-save notices use that tail anchor.
- Add a helper for retrieving tail notices.

### Task 2: Move Dialog Actions Into the Drawer Header

**Files:**
- Create: `1_core_orchestrator/frontend/src/components/workspace/__tests__/MedicalRecordDrawer.test.tsx`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordDrawer.tsx`
- Modify: `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordCard.tsx`

**Step 1: Write the failing tests**

- Assert the drawer prefetches the medical record payload before opening.
- Assert the header renders `恢复未保存` / `刷新资料` / `保存更改` alongside `重新加载` when the card provides dialog actions.

**Step 2: Run focused tests to verify they fail**

```powershell
pnpm test -- --run src/components/workspace/__tests__/MedicalRecordDrawer.test.tsx src/components/workspace/__tests__/MedicalRecordCard.test.tsx
```

**Step 3: Implement the minimal UI changes**

- Let `MedicalRecordCard` expose dialog action handlers/state to its parent only in dialog mode.
- Render the three existing actions in the drawer header instead of the card header when those dialog actions are available.
- Keep local button rendering unchanged for non-dialog usage.

### Task 3: Remove the Blocking First-Open Drawer State

**Files:**
- Modify: `1_core_orchestrator/frontend/src/components/workspace/MedicalRecordDrawer.tsx`

**Step 1: Extend the failing drawer test**

- Assert the drawer starts fetching for the active thread before the modal is opened.
- Assert reopening with cached data does not fall back to the full-page loading placeholder.

**Step 2: Implement the minimal fetch strategy**

- Prefetch the medical record in the background when `threadId` becomes available.
- Only show the blocking loading placeholder if no cached data exists for the active thread.
- Keep `重新加载` as an explicit hard refresh button.

### Task 4: Verify the Full Frontend Slice

**Files:**
- Modify: `docs/plans/2026-04-05-patient-record-system-notice-smoke.md` if manual expectations change.

**Step 1: Run focused tests**

```powershell
pnpm test -- --run src/app/workspace/chats/[thread_id]/page.orchestration.test.ts src/core/patient/systemNotices.test.ts src/components/workspace/__tests__/MedicalRecordCard.test.tsx src/components/workspace/__tests__/MedicalRecordDrawer.test.tsx
```

**Step 2: Run static validation**

```powershell
pnpm typecheck
pnpm lint
```

**Step 3: Update smoke notes only if the visible action layout or notice behavior wording changed**