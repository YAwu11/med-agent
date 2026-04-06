# Doctor Imaging Browser And CI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a browser-level regression for doctor-side imaging review and wire the frontend/backend imaging checks into GitHub Actions CI.

**Architecture:** Mount the real `ImagingViewer` in a narrow mock route, cover it with Playwright request interception, then add a repo-level workflow with separate frontend and backend jobs so the same regression layers run automatically.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.8, Playwright, Vitest, GitHub Actions, Python 3.12, uv, pytest.

---

### Task 1: Add Playwright frontend scaffolding

**Files:**
- Modify: `1_core_orchestrator/frontend/package.json`
- Create: `1_core_orchestrator/frontend/playwright.config.ts`

**Step 1: Write the failing browser test entrypoint**
- Add `pnpm test:e2e` script and Playwright config before the first test exists.

**Step 2: Run the command to verify red**
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm test:e2e`
- Expected: fail because the test file or route does not exist yet.

**Step 3: Add the minimal Playwright config**
- Use a local Next dev server as `webServer`.
- Reuse existing port 3000 and current repo structure.

### Task 2: Add a doctor imaging mock page and Playwright regression

**Files:**
- Create: `1_core_orchestrator/frontend/src/app/mock/doctor-imaging-review/page.tsx`
- Create: `1_core_orchestrator/frontend/tests/e2e/doctor-imaging-review.spec.ts`

**Step 1: Write the failing Playwright test**
- Open the mock page.
- Assert summary/probability/rejected content is visible.
- Intercept the save request and assert the browser sends `{ doctor_result: ... }` with normalized finding ids.

**Step 2: Run the focused e2e command to verify red**
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm test:e2e -- doctor-imaging-review`

**Step 3: Add the minimal mock page**
- Render `ImagingViewer` with deterministic props and structured data.
- Avoid fetching external state so the regression stays stable.

**Step 4: Re-run the e2e command**
- Confirm green.

### Task 3: Add GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/doctor-imaging-ci.yml`

**Step 1: Add the failing workflow definition**
- Create a workflow with separate frontend and backend jobs.

**Step 2: Implement frontend CI job**
- Setup Node and pnpm.
- Install frontend dependencies.
- Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm exec playwright install --with-deps chromium`, and `pnpm test:e2e`.

**Step 3: Implement backend CI job**
- Setup Python and `uv`.
- Run `uv sync --group dev` in `1_core_orchestrator/backend`.
- Run `PYTHONPATH=. PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 uv run pytest tests/test_uploads_router.py tests/test_imaging_reports_router.py -q`.

### Task 4: Sync docs and run local verification

**Files:**
- Modify: `1_core_orchestrator/frontend/README.md`
- Modify: `1_core_orchestrator/frontend/CLAUDE.md`
- Modify: `1_core_orchestrator/backend/README.md`

**Step 1: Update docs**
- Add Playwright test command and CI coverage notes.

**Step 2: Run frontend verification**
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm test:e2e -- doctor-imaging-review`
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm test`
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm lint`
- Run: `Set-Location 1_core_orchestrator/frontend; pnpm typecheck`

**Step 3: Run backend verification**
- Run: `Set-Location 1_core_orchestrator/backend; $env:PYTHONPATH='.'; $env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'; .\.venv\Scripts\python.exe -m pytest tests/test_uploads_router.py tests/test_imaging_reports_router.py -q`