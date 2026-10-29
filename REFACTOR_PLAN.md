# Repository Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start the migration described in `AGENT_ARCHITECTURE.md` while preserving the current browser, API, payment, and ZIP behavior.

**Architecture:** Move existing entry points into `apps/web` and `apps/api` and the type contract into `packages/contracts`. Keep one root package and existing behavior. LangGraph worker, async generation API and runtime schema are later independent phases.

**Tech Stack:** Node 24, React 19, Vite 8, TypeScript, SQLite, alipay-sdk.

**Spec:** `AGENT_ARCHITECTURE.md`; product constraints in `PROJECT.md` and payment boundaries in `AGENTS.md`.

## Global Constraints

- PDF bytes and unconfirmed parsed content remain in browser memory.
- Payment facts are verified server side; no migration may weaken ownership, CSRF, share or ZIP authorization.
- The first generation skeleton stays Marquee + StackedCards with three skins and no model call.
- Do not add real resume fixture data, `.env`, `.alipay-sandbox.json`, or `data/` to Git.
- This plan is a structural slice. No new user feature or LangGraph dependency is introduced yet.

## Review Focus

1. A fresh checkout must contain the public mock config that the app and tests import.
2. `.env`, sandbox credentials and SQLite must still resolve from repository root after API relocation.
3. Production static hosting and offline ZIP must read the relocated web build and export assets.
4. Private resume fixtures must stay ignored after relocation; all automated tests use tracked synthetic samples.
5. Vite and test resolution must not accidentally include API tests or generated export artifacts.

---

### Task 1: Freeze architecture and public demo contract

**Files:** `AGENT_ARCHITECTURE.md`, `REFACTOR_PLAN.md`, `.gitignore`, `src/data/config.json` → `apps/web/src/demo/config.json`, imports referencing mock config.

**Interfaces:** Public demo JSON remains a `DesignConfig`; app and unit tests import it from `src/demo/config.json` after relocation.

- [x] Record the no-input, no-model V1 decision and target module boundaries in the architecture document.
- [x] Move only the synthetic Alex Morgan mock into a tracked `demo` directory; leave real resume fixtures ignored.
- [x] Run `npm run build` and `npm test`; both passed.

### Task 2: Move web application and shared type contract

**Files:** `src/**` → `apps/web/src/**`, `index.html` → `apps/web/index.html`, `public/favicon.svg` → `apps/web/public/favicon.svg`, `types/config.ts` → `packages/contracts/src/config.ts`, `vite.config.ts`, `vite.export.config.ts`, `tsconfig.json`, `package.json`.

**Interfaces:** Keep the existing `DesignConfig` shape. Vite root becomes `apps/web`; exported IIFE assets go to `apps/web/public/export`. Root npm commands remain the public entry points.

- [x] Move files and update imports, Vite root/test setup, TypeScript include and build/preview paths.
- [x] Run `npm run build` and `npm test`; both passed without changing UI semantics.

### Task 3: Move API and fix root-relative resources

**Files:** `server/**` → `apps/api/src/**`, `scripts/verify-export.mjs`, synthetic fixtures, `package.json`, `README.md`, `AGENTS.md`, `.gitignore`.

**Interfaces:** Root `.env`, `.alipay-sandbox.json`, `data/`; web build `apps/web/dist`; export bundle `apps/web/public/export`. Existing HTTP routes and responses remain unchanged.

- [x] Move API modules and tests; update dev/start/test scripts and all `import.meta.url` resource paths.
- [x] Preserve private fixture ignore rule under the new web location; replace real resume test inputs with tracked synthetic fixtures.
- [x] Run `npm run build`, `npm test`, `npm run test:payment`, `npm run verify:export`; all passed.
- [x] Request `/api/offer` and `/` from an in-process production HTTP server against built files; both returned expected JSON and HTML. The sandbox blocked a fixed manual port, so the smoke test binds an ephemeral port.

### Task 4: Audit the migration

**Files:** All changed paths.

- [x] Search for stale imports and old path references; inspect `git diff --check`, `git status --short` and changed file list.
- [x] Document the next LangGraph/worker slice clearly in `AGENT_ARCHITECTURE.md`.
