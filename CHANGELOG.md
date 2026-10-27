# Changelog

All notable project changes should be recorded here. Do not retroactively invent implementation changes.

## 2026-10-26 — Planning baseline drafted

- Drafted Milestone 0 project plan, proposed architecture, and initial security/threat model.
- Recorded that the supplied initial audit found the project uninitialized and did not verify application code or runtime behavior.
- No application implementation or runtime test is claimed by this entry.

## 2026-10-26 — Milestone 1 implemented and verified (browser-based)

- Built the Meridian OS command centre per the user's direction: browser tab (no Electron), zero-dependency Node server bound to 127.0.0.1, vanilla JS frontend, JSON file persistence with atomic writes.
- Command centre UI: animated particle core (adaptive quality, reduced-motion fallback, pauses when hidden), orbital navigation, left panels (Micro Apps, Calendar, Connections), right panels (Email disconnected state, Skills Deck, Routines), bottom dock with quick capture.
- Five working micro-apps: Quick Capture (with triage to task/note), Notes, Tasks, Docs, Routine Launcher.
- Skills engine: validated file-based manifests (reference / artifact / self-triggered), deterministic artifact generation into Docs, JSON import with server-side validation and duplicate rejection.
- Routines engine: manual execution with query/skill/notify/notify-if steps, approval gates, daily run limits, persistent history.
- Memory: Markdown areas with index, note capture, editor, archive, and approve-before-apply proposals.
- Integrations registry with enforced honesty: `connected` is refused without configuration (verified with HTTP 409).
- Assistant: local deterministic commands only; no model provider configured or claimed.
- Launcher verified end-to-end: cold start via `launch\start-meridian.cmd`, health polling, graceful shutdown via `launch\stop-meridian.cmd`; Desktop shortcut created and target-verified.
- Tests: 15/15 passing (`npm test`); stack deviation from the Electron proposal documented in PLAN.md §8.

## 2026-10-27 — Security hardening (per Overseer report)

- **DEF-001 (High) Fixed**: Added Origin/Referer validation to `/api/shutdown` and `/api/open-data` endpoints to prevent CSRF. Cross-origin requests now return 403.
- **DEF-002 (Medium) Fixed**: Added Content-Security-Policy headers to all responses:
  - Static assets: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`
  - API responses: `default-src 'none'; frame-ancestors 'none'`
- **DEF-003 (Medium) Fixed**: Hardened `safeJoin` in `server/lib/util.js` using `fs.realpathSync.native` on both base and target (with parent-directory fallback for non-existent targets) to prevent symlink escape attacks.
- Updated `docs/SECURITY.md` §4 to reflect browser-based security baseline (removed Electron-specific section).
- Updated `docs/ARCHITECTURE.md` to document actual implemented architecture (removed proposed Electron design).
- Updated `STATUS.md` with verified security fixes and current test status.
- All 15 server tests + 3 additional tests pass (18 total).

## 2026-10-27 — LLM Provider Integration (LiteLLM / OpenAI-compatible)

- Added `litellm` provider in `server/lib/provider.js` with full function-calling support for agentic workflows.
- Provider connects to any LiteLLM/OpenAI-compatible endpoint (local or remote) with configurable baseUrl, apiKey, and model.
- Implemented 8 function tools: `list_store`, `search_all`, `create_task`, `create_note`, `capture_inbox`, `run_routine`, `invoke_skill`, `memory_note`.
- Provider auto-falls back to local deterministic engine when not configured (honesty gate).
- Added LLM configuration UI in Settings module: enable/disable, baseUrl, apiKey, model name.
- Bootstrap endpoint now returns `bootstrapProvider` field (`local-deterministic` or `litellm`).
- Assistant module shows current provider status (chip indicator: "Local only" vs "LLM enabled").
- Updated `putSettings` in store.js to allow `llm` configuration key.
- All 18 tests pass (15 server + 3 additional).
