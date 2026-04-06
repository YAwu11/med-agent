# Repo Layout Cleanup Design

## Goal

Reduce root-level clutter without breaking the monorepo's real runtime entry points, developer scripts, or OCR benchmark assets.

## Scope

- Keep operational entry points stable, especially 项目控制台.bat at the repository root.
- Move root-level documents into purpose-specific folders under docs/.
- Move root-level helper scripts into scripts/start and scripts/dev.
- Preserve OCR sample assets, but move them out of the root into samples/ocr_reports.
- Relocate tracked scratch artifacts into debug/log folders inside their owning subprojects.
- Update scripts and benchmark utilities to use repo-relative paths after relocation.

## Decisions

### Keep root minimal

The repository root should keep only the true monorepo anchors: README, onboarding/agent guidance, the three top-level services, docs, scripts, samples, and the main Windows launcher.

### Preserve the existing Windows launcher location

项目控制台.bat remains at the root because it is the user-facing entry point and existing tests already assert that location.

### Separate concerns by folder intent

- docs/onboarding: handoff and onboarding material
- docs/handoffs: issue/problem-transfer documents
- docs/architecture: architecture notes not tied to a specific subproject
- docs/history: repository history snapshots
- scripts/start: startup helpers
- scripts/dev: ad hoc developer utilities
- samples/ocr_reports: OCR benchmark images and sidecar outputs

### Prefer repo-relative paths

Any script moved away from the root must stop relying on absolute machine-specific paths.

## Trade-offs

### Pros

- The root directory becomes much easier to scan.
- Supporting documents stop mixing with runnable scripts.
- OCR assets remain available for manual and benchmark workflows.
- Future cleanup can happen incrementally inside each subproject.

### Cons

- Several internal benchmark/debug scripts need path updates.
- Historical scratch artifacts remain in the repository, only better organized.

## Non-Goals

- No reorganization of the primary runtime code inside 1_core_orchestrator or 2_mcp_ragflow_lite.
- No renaming of the main batch launcher.
- No changes to product logic.