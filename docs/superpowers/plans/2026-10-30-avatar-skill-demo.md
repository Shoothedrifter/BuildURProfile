# Avatar Skill Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a local, runnable portrait-to-stylized-avatar flow through Wibi Style recipes and LangGraph, and display its image in the generated page hero.

**Architecture:** Keep PDF parsing in the browser. A session-protected API accepts one portrait and queues a task; a separate worker runs a persistent LangGraph graph, loads one pinned local Wibi recipe, calls an image edit provider, and stores the output as a session-bound asset. The browser polls task status and adds a preview-only hero artwork reference. Existing paid delivery rejects avatar artwork.

**Tech Stack:** Node 24, LangGraph.js, SQLite checkpointer, OpenAI Images Edit API, React/Vite, Vitest and Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-30-avatar-skill-demo-design.md`

**Status (2026-10-31):** Tasks 1–4 are implemented. Task 5 completed browser/API/worker verification with synthetic inputs, independent code review, and final regressions. Real image generation remains unverified until a local API key is configured. The implementation is one reviewed branch change rather than per-task commits.

## Global Constraints

- Only `retro-flat-anime-head`, `crayon-flat-naive`, `textile-toy-portrait` are selectable.
- Wibi rules and reference images are installed under ignored local `data/wibi-style-pinned`; they are not committed or executed as scripts.
- This is a private local demo. No portrait artwork enters paid share or ZIP export without separate commercial permission.
- PDF bytes, raw extracted text and source references remain browser-local; photo bytes and API key never enter graph checkpoints or logs.
- The photo is optional; PDF-only behavior remains supported. GitHub Pages remains a static PDF-only preview.
- This version uses each style's original background and has no cutout, 3D model or pointer interaction.

## Review Focus

1. An unknown style ID or tampered recipe path must fail closed before any model call; cover in Task 1 tests.
2. Another anonymous session must not read task state or portrait/output assets; cover in Task 2 API tests.
3. A worker restart must not strand a queued task or duplicate a completed generation; cover in Task 3 tests.
4. A malicious or invalid image payload must be rejected before storage or rendering; cover in Task 2 tests.
5. A caller must not get an avatar into paid delivery by bypassing UI; cover in Task 4 server tests.

---

### Task 1: Pinned Wibi Style Adapter and Provider

**Files:** Create `apps/worker/src/styles.mjs`, `apps/worker/src/provider.mjs`, `apps/worker/src/styles.test.mjs`; modify `package.json`, `.env.example`, `.gitignore`.

**Interfaces:** `listAvatarStyles()` returns exactly three public `{id,label,description}` entries; `loadStyleRecipe(id, root)` returns trusted `{id,version,instructions,referencePaths}`; `createOpenAIImageProvider({apiKey,model})` exposes `edit({portrait,recipe}) -> {bytes,mime}`.

- [x] Write adapter tests for three registered IDs, unknown ID rejection, pinned recipe hashes and path traversal rejection; provider test verifies `FormData` contains portrait, style references and model without exposing key.
- [x] Run `node --test apps/worker/src/styles.test.mjs`; expect failure from missing implementation.
- [x] Implement the adapter and provider; install three Wibi recipes into ignored local data and record commit/hash in a committed manifest, not their copyrighted content.
- [x] Run the focused test; expect pass. Record Task 1.

### Task 2: Session-bound Portrait and Generation API

**Files:** Create `apps/api/src/generations.mjs`, `apps/api/src/generations.test.mjs`; modify `apps/api/src/database.mjs`, `apps/api/src/http.mjs`.

**Interfaces:** `createGenerationService({db,assetRoot})` handles portrait validation/storage, idempotent task enqueue, session-scoped task reads and asset reads. HTTP routes: `POST /api/portraits`, `POST /api/generations`, `GET /api/generations/:id`, `GET /api/hero-assets/:id`.

- [x] Write tests for image signature/size and owner-only reads, CSRF, idempotent task creation and private asset headers.
- [x] Run `node --test apps/api/src/generations.test.mjs`; expect feature failures.
- [x] Implement SQLite tables and API routes; no image or raw PDF data in JSON task state.
- [x] Run focused API tests and existing payment suite; expect pass. Record Task 2.

### Task 3: Durable LangGraph Worker

**Files:** Create `apps/worker/src/graph.mjs`, `apps/worker/src/runner.mjs`, `apps/worker/src/graph.test.mjs`; modify `apps/api/src/dev.mjs`, `package.json`.

**Interfaces:** `buildGenerationGraph({styleLoader,provider,assets,checkpointer})` compiles a `StateGraph` with config validation, an optional avatar branch, first-screen asset assembly and artifact checks. Browser scoring/mapping and trusted React rendering stay outside this graph. `runNextGeneration({service,graph})` leases a queued task and records terminal state. Stable thread ID is task ID.

- [x] Write tests using a fake provider proving graph node order, no-photo branch, real style adapter invocation, checkpoint resume and restart handling.
- [x] Run `node --test apps/worker/src/graph.test.mjs`; expect failure.
- [x] Implement worker and launch it with `npm run dev`; report failures as task errors, never as fake images.
- [x] Run focused tests plus build; expect pass. Record Task 3.

### Task 4: Upload UI, Hero Preview and Delivery Guard

**Files:** Create `apps/web/src/lib/generationApi.ts`; modify `apps/web/src/App.tsx`, `apps/web/src/ShowcasePage.tsx`, `packages/contracts/src/config.ts`, relevant CSS and UI/API tests, `apps/api/src/service.mjs`, `README.md`.

**Interfaces:** Optional `heroArtwork: {assetUrl:string; styleId:string; alt:string}` only for local preview. UI sends portrait only after generate action, polls status, then displays artwork at hero start. API refuses any config carrying `heroArtwork` for paid project creation/update.

- [x] Write UI tests for three choices, image preview, async generation, PDF-only fallback and first-screen hero; write server test that a tampered avatar config is rejected.
- [x] Run focused tests; expect feature failures.
- [x] Implement UI, responsive hero layout, local-only notice and server guard; keep Pages PDF-only.
- [x] Run `npm run build`, `npm test`, `npm run test:payment`, `npm run verify:export`; expect pass. Record Task 4.

### Task 5: Local End-to-End Verification

**Files:** Update plan ledger and `README.md` only if setup steps need correction.

- [x] Start `npm run dev`; complete browser upload/PDF flow with synthetic inputs, verify missing-key task failure and desktop/mobile first-screen layout with an intercepted synthetic image, then inspect checkpoint for photo bytes. Interception is layout QA only.
- [ ] With a locally configured `OPENAI_API_KEY`, run all three styles through the real provider and inspect actual first-screen renders.
- [x] Confirm worker restart recovery and clear error when no API key is configured; a fresh submit serves as retry.
- [x] Record that the real provider call is blocked by the absent local `OPENAI_API_KEY`; synthetic browser interception verifies layout only.
- [x] Run final suite and whole-branch review; fix findings with regression tests and record credential blocker.
