# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DeerFlow Frontend is a Next.js 16 web interface for an AI agent system. It communicates with a LangGraph-based backend to provide thread-based AI conversations with streaming responses, artifacts, and a skills/tools system.

**Stack**: Next.js 16, React 19, TypeScript 5.8, Tailwind CSS 4, pnpm 10.26.2

## Commands

| Command | Purpose |
| ------- | ------- |
| `pnpm dev` | Dev server with Turbopack (<http://localhost:3000>) |
| `pnpm build` | Production build |
| `pnpm check` | Lint + type check (run before committing) |
| `pnpm lint` | ESLint only |
| `pnpm lint:fix` | ESLint with auto-fix |
| `pnpm test` | Vitest run |
| `pnpm test:e2e` | Playwright browser regression |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm typecheck` | TypeScript type check (`tsc --noEmit`) |
| `pnpm start` | Start production server |

Vitest + Testing Library are configured for focused component regressions in jsdom, and Playwright covers a narrow browser-level doctor imaging harness. Current doctor-side imaging coverage lives in `src/components/doctor/__tests__/ImagingViewer.test.tsx`, `tests/e2e/doctor-imaging-review.spec.ts`, and `src/app/mock/doctor-imaging-review/page.tsx`, locking structured summary rendering plus the `{ doctor_result: ... }` save payload contract in both component and browser contexts.

## Architecture

```text
Frontend (Next.js) ──▶ LangGraph SDK ──▶ LangGraph Backend (lead_agent)
                                              ├── Sub-Agents
                                              └── Tools & Skills
```

The frontend is a stateful chat application. Users create **threads** (conversations), send messages, and receive streamed AI responses. The backend orchestrates agents that can produce **artifacts** (files/code) and **todos**.

### Source Layout (`src/`)

- **`app/`** — Next.js App Router. Routes: `/` (landing), `/workspace/chats/[thread_id]` (chat).
- **`components/`** — React components split into:
  - `ui/` — Shadcn UI primitives (auto-generated, ESLint-ignored)
  - `ai-elements/` — Vercel AI SDK elements (auto-generated, ESLint-ignored)
  - `doctor/` — doctor-side review panels including EvidenceDesk, imaging review, OCR, and lab viewers
  - `workspace/` — Chat page components (messages, artifacts, settings)
  - `landing/` — Landing page sections
- **`core/`** — Business logic, the heart of the app:
  - `threads/` — Thread creation, streaming, state management (hooks + types)
  - `api/` — LangGraph client singleton
  - `artifacts/` — Artifact loading and caching
  - `i18n/` — Internationalization (en-US, zh-CN)
  - `settings/` — User preferences in localStorage
  - `memory/` — Persistent user memory system
  - `skills/` — Skills installation and management
  - `messages/` — Message processing and transformation
  - `mcp/` — Model Context Protocol integration
  - `models/` — TypeScript types and data models
- **`hooks/`** — Shared React hooks
- **`lib/`** — Utilities (`cn()` from clsx + tailwind-merge)
- **`server/`** — Server-side code (better-auth, not yet active)
- **`styles/`** — Global CSS with Tailwind v4 `@import` syntax and CSS variables for theming

### Data Flow

1. User input → thread hooks (`core/threads/hooks.ts`) → LangGraph SDK streaming
2. Stream events update thread state (messages, artifacts, todos)
3. TanStack Query manages server state; localStorage stores user settings
4. Components subscribe to thread state and render updates

### Key Patterns

- **Server Components by default**, `"use client"` only for interactive components
- **Thread hooks** (`useThreadStream`, `useSubmitThread`, `useThreads`) are the primary API interface
- **LangGraph client** is a singleton obtained via `getAPIClient()` in `core/api/`
- **Environment validation** uses `@t3-oss/env-nextjs` with Zod schemas (`src/env.js`). Skip with `SKIP_ENV_VALIDATION=1`

## Code Style

- **Imports**: Enforced ordering (builtin → external → internal → parent → sibling), alphabetized, newlines between groups. Use inline type imports: `import { type Foo }`.
- **Unused variables**: Prefix with `_`.
- **Class names**: Use `cn()` from `@/lib/utils` for conditional Tailwind classes.
- **Path alias**: `@/*` maps to `src/*`.
- **Components**: `ui/` and `ai-elements/` are generated from registries (Shadcn, MagicUI, React Bits, Vercel AI SDK) — don't manually edit these.
- **Targeted validation**: for doctor-side cleanup work, run `pnpm test -- ImagingViewer`, `pnpm test:e2e -- doctor-imaging-review`, then isolated ESLint commands like `pnpm exec eslint "src/components/doctor/**/*.tsx"`, before relying on repo-wide lint output.

## Environment

Backend API URLs are optional; an nginx proxy is used by default:

```text
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:8001
NEXT_PUBLIC_LANGGRAPH_BASE_URL=http://localhost:2024
```

Production-mode builds also require `BETTER_AUTH_SECRET` because `src/env.js` validates it when `NODE_ENV=production`.
Use any 32+ character placeholder for local verification and a real random secret for shared environments.
`BETTER_AUTH_URL` is optional for the build itself, but setting it avoids Better Auth base URL warnings.
Better Auth may log the phrase `BETTER_AUTH_BASE_URL`, but this repo currently resolves the URL from `BETTER_AUTH_URL` unless `baseURL` is set in code.
Prefer real env values locally; reserve `SKIP_ENV_VALIDATION=1` for Docker or CI escape hatches.

Repo-level CI for this frontend slice lives in `.github/workflows/doctor-imaging-ci.yml`. The frontend job runs `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test:e2e -- doctor-imaging-review`.

For local production-style startup validation, use this exact sequence:

1. Copy `.env.example` to `.env` and set `BETTER_AUTH_SECRET`.
2. Optionally set `BETTER_AUTH_URL=http://localhost:3000` to silence base URL warnings.
3. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`, then `pnpm start`.
4. Open `http://localhost:3000` and verify the app boots without env validation errors.

Requires Node.js 22+ and pnpm 10.26.2+.
