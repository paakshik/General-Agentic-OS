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
