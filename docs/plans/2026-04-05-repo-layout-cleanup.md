# Repo Layout Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize root-level files and selected subproject scratch artifacts into clearer directories while preserving runnable entry points and OCR sample workflows.

**Architecture:** Keep the monorepo root focused on true entry points, move documents and helper scripts into dedicated folders, preserve OCR sample assets under a samples area, and repair all affected relative paths.

**Tech Stack:** Git, PowerShell, Python, batch scripts, Markdown documentation

---

### Task 1: Snapshot current workspace state

**Files:**
- Modify: git branch state only

**Step 1: Create a dedicated cleanup branch**

Run: `git switch -c chore/repo-layout-cleanup-20260405`

**Step 2: Commit the current dirty workspace as a backup snapshot**

Run: `git add -A && git commit -m "chore: snapshot workspace before repo layout cleanup"`

**Step 3: Push the branch as a remote backup if networking permits**

Run: `git push -u origin chore/repo-layout-cleanup-20260405`

### Task 2: Re-home root documents and helper scripts

**Files:**
- Modify: repository layout only
- Test: path/reference checks

**Step 1: Move documents into docs/**

- onboarding docs into `docs/onboarding/`
- handoff docs into `docs/handoffs/`
- history docs into `docs/history/`
- general architecture notes into `docs/architecture/`
- legacy plan files into `docs/plans/`

**Step 2: Move helper scripts into scripts/**

- startup helpers into `scripts/start/`
- ad hoc utilities into `scripts/dev/`

**Step 3: Delete empty root placeholders**

- remove `design_scheme.md`

### Task 3: Preserve and relocate OCR sample assets

**Files:**
- Modify: `samples/ocr_reports/**`
- Test: benchmark/debug path checks

**Step 1: Move `test_picture/` into `samples/ocr_reports/`**

**Step 2: Drop Windows shell noise**

- remove `desktop.ini`

**Step 3: Update all benchmark/debug scripts that reference the old root sample path**

### Task 4: Re-home tracked scratch artifacts

**Files:**
- Modify: `1_core_orchestrator/debug/*`
- Modify: `1_core_orchestrator/frontend/debug/*`
- Modify: `3_mcp_medical_vision/logs/*`

**Step 1: Move tracked temporary files into local debug/log folders**

**Step 2: Keep ownership local to the subproject that produced them**

### Task 5: Repair path-sensitive scripts

**Files:**
- Modify: `scripts/dev/read_log.py`
- Modify: `scripts/dev/test_mcp_return.py`
- Modify: `scripts/start/start_all_with_mcp.ps1`
- Modify: OCR benchmark/debug scripts in `1_core_orchestrator/backend/`

**Step 1: Replace absolute paths with repo-relative logic**

**Step 2: Keep behavior unchanged except for the new locations**

### Task 6: Verify and commit cleanup

**Files:**
- Test: changed Python and PowerShell files

**Step 1: Run syntax verification for changed Python files**

**Step 2: Parse the moved PowerShell script to verify syntax**

**Step 3: Search for stale old paths and confirm none remain in active files**

**Step 4: Commit cleanup**

Run: `git add -A && git commit -m "chore: reorganize repo layout"`