# [Phase 7] Unified Doctor Desk Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a professional Doctor Dashboard alongside the existing patient interface within the single `1_core_orchestrator/frontend` Next.js application, utilizing a Configurable Human-in-the-Loop (cHITL) toggle.

**Architecture:** Monolithic Frontend (Option B). The `app` directory will be structurally split into `app/doctor` and `app/patient`. The backend LangGraph flow will be modified to support a `supervision_mode` flag. When `supervision_mode` is true, the graph halts at specific review points (e.g., after imaging). When false, it runs automatically.

**Tech Stack:** Next.js (App Router), TailwindCSS, SQLite, FastAPI.

---

### Task 1: Root Layout & Route Split

**Files:**
- Modify: `1_core_orchestrator/frontend/src/app/page.tsx`
- Rename/Move: Directory `app/workspace` to `app/patient` (or keep `app/workspace` but add new home page links).

**Step 1: Create Landing Selection Page**
Modify `src/app/page.tsx` to act as an entry portal. Add two large buttons: "👨‍⚕️ 医生入口 (Doctor Portal)" and "😷 患者入口 (Patient Portal)".

**Step 2: Update Links**
"患者入口" points to `/workspace` (or `/patient/chat`). "医生入口" points to `/doctor/dashboard`.

**Step 3: Commit**
```bash
git add 1_core_orchestrator/frontend/src/app
git commit -m "feat(frontend): implement dual-portal landing page"
```

---

### Task 2: Doctor Dashboard Shell & Navigation

**Files:**
- Create: `1_core_orchestrator/frontend/src/app/doctor/layout.tsx`
- Create: `1_core_orchestrator/frontend/src/components/doctor/sidebar.tsx`
- Create: `1_core_orchestrator/frontend/src/components/doctor/header.tsx`

**Step 1: Build the Shell**
Implement a professional dark sidebar and a top header for the `/doctor` routes.

**Step 2: Add the HITL Toggle**
Add a "【人工监管模式 (Supervision Mode)】" toggle switch in the Header. (For now, it can just be a local state or write to localStorage/API).

**Step 3: Commit**
```bash
git add 1_core_orchestrator/frontend/src
git commit -m "feat(doctor): implement doctor layout and navigation shell"
```

---

### Task 3: Patient Worklist (Dashboard Home)

**Files:**
- Create: `1_core_orchestrator/frontend/src/app/doctor/dashboard/page.tsx`
- Modify: `1_core_orchestrator/backend/app/gateway/routers/imaging_reports.py` (Add simple GET for all pending threads if needed)

**Step 1: Fetch Threads**
Query the backend for a list of recent threads/patients and their status.

**Step 2: Build the Data Grid**
Render a professional data table prioritizing patients with `status='pending_review'`. Include quick-action buttons to enter their workspace.

**Step 3: Commit**
```bash
git add 1_core_orchestrator
git commit -m "feat(doctor): implement global patient queue dashboard"
```

---

### Task 4: Full-Screen Workspace (The Desk)

**Files:**
- Create: `1_core_orchestrator/frontend/src/app/doctor/workspace/[thread_id]/page.tsx`

**Step 1: Create the 3-Column Layout**
Build a grid layout (e.g., `grid-cols-12`). Left col (3): Patient Info. Middle col (6): Modality viewer (reuse `ImagingReviewPanel`). Right col (3): Global Copilot and Final Diagnosis button.

**Step 2: Integrate Core Components**
Refactor the existing `BboxCanvas` and `DiagnosticDashboard` so they can be securely placed in a full-screen layout rather than a collapsing right sidebar.

**Step 3: Commit**
```bash
git add 1_core_orchestrator/frontend/src/app/doctor/workspace
git commit -m "feat(doctor): build 3-column diagnostic desk workspace"
```

---

### Task 5: Backend Configurable HITL State Machine

**Files:**
- Modify: `1_core_orchestrator/backend/packages/harness/deerflow/src/deerflow/main.py` (or respective node architecture)

**Step 1: Check Supervision Mode**
Inject logic in the LangGraph visual node or routing node: If `supervision_mode` is enabled (from global config or state), drop into `interrupt` or return END temporarily to await human review.

**Step 2: Test the Graph**
Run backend tests to verify that the Agent halts correctly.

**Step 3: Commit**
```bash
git add 1_core_orchestrator/backend
git commit -m "feat(backend): implement configurable HITL halt logic in LangGraph"
```
