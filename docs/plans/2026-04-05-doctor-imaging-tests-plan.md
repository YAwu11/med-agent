# Doctor Imaging Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add frontend component-test infrastructure for doctor-side imaging review and a backend route-level regression that covers the brain MRI upload-to-review flow.

**Architecture:** Add a minimal Vitest + jsdom setup in the frontend, target `ImagingViewer` with component tests for rendering and save-contract behavior, then extend backend regression coverage with a higher-level FastAPI flow that exercises upload guidance state and doctor-review persistence together.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.8, Vitest, Testing Library, FastAPI, pytest.

---

### Task 1: Add frontend test infrastructure

**Files:**
- Modify: `1_core_orchestrator/frontend/package.json`
- Create: `1_core_orchestrator/frontend/vitest.config.ts`
- Create: `1_core_orchestrator/frontend/src/test/setup.ts`

**Step 1: Write the failing test command expectation**
- Add `pnpm test` / `pnpm test:watch` scripts and Vitest config before any component tests exist.

**Step 2: Run test command to verify it fails for the missing test file/setup**
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm test -- --runInBand`
- Expected: fail because no tests/setup are available yet.

**Step 3: Write minimal infrastructure**
- Install only the required dev dependencies.
- Configure jsdom, alias `@`, and shared jest-dom setup.

**Step 4: Re-run the command**
- Confirm Vitest boots successfully.

### Task 2: Add ImagingViewer component regressions

**Files:**
- Create: `1_core_orchestrator/frontend/src/components/doctor/__tests__/ImagingViewer.test.tsx`
- Modify: `1_core_orchestrator/frontend/src/components/doctor/ImagingViewer.tsx` only if the tests expose missing seams

**Step 1: Write failing tests**
- Test rendering of `summary`, `densenet_probs`, and `rejected` from `initialStructuredData`.
- Test clicking save sends `{ doctor_result: ... }` to the expected URL.
- Test missing finding IDs are normalized before save/export.

**Step 2: Run the focused tests to verify red**
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm test -- ImagingViewer`

**Step 3: Write minimal implementation changes if required**
- Only extract or expose helpers if the current component shape is impossible to test cleanly.

**Step 4: Re-run the focused tests**
- Confirm green.

### Task 3: Add backend upload-to-review regression

**Files:**
- Modify: `1_core_orchestrator/backend/tests/test_uploads_router.py`
- Modify: `1_core_orchestrator/backend/tests/test_imaging_reports_router.py` if shared helpers are needed

**Step 1: Write the failing regression**
- Build a route-level or helper-driven flow that uploads four NIfTI files, verifies sequence guidance reaches `ready_for_analysis=True`, and then saves a doctor review payload against the generated report contract.

**Step 2: Run the targeted backend tests to verify red**
- Run: `Set-Location 1_core_orchestrator/backend; $env:PYTHONPATH='.'; $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'; .\.venv\Scripts\python.exe -m pytest tests/test_uploads_router.py tests/test_imaging_reports_router.py -q`

**Step 3: Write minimal implementation only if needed**
- Prefer test-only additions; touch production code only if the new end-to-end flow exposes a real contract hole.

**Step 4: Re-run the targeted backend tests**
- Confirm green.

### Task 4: Sync docs and verify all checks

**Files:**
- Modify: `1_core_orchestrator/frontend/README.md`
- Modify: `1_core_orchestrator/frontend/CLAUDE.md`
- Modify: `1_core_orchestrator/backend/README.md`
- Modify: `1_core_orchestrator/backend/CLAUDE.md`

**Step 1: Update docs**
- Document the new frontend test commands and the added imaging regression coverage.

**Step 2: Run frontend verification**
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm test -- ImagingViewer`
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm lint`
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm typecheck`

**Step 3: Run backend verification**
- Run: `Set-Location 1_core_orchestrator/backend; $env:PYTHONPATH='.'; $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'; .\.venv\Scripts\python.exe -m pytest tests/test_uploads_router.py tests/test_imaging_reports_router.py -q`