# General Agentic OS — Status

**Product name:** Meridian OS (working name; renaming is a one-line change)
**Current milestone:** Milestone 1 complete and verified; parts of M2–M3 included
**Last updated:** 2026-10-26
**Direction:** Browser-based, local-first command centre (user decision; no Electron). Single-click Windows launch preserved.

## Verified facts (this session, with evidence)

- Runtime: Node v24.11.0, npm 11.6.1, Windows 11 Pro. No dependencies installed (zero-dep by design).
- `node --test test/server.test.js`: **15/15 passing**. Coverage: health/static, CRUD persistence across full server restart, unknown-collection rejection, path traversal blocked (static + memory), skill validation/artifact invocation, self-triggered approval requirement, skill import validation + duplicate rejection, routine runs + persistent history, approval gates, integration honesty gate (409 without config), memory note/edit/proposal-approval, search, local deterministic assistant, secret redaction, graceful shutdown.
- Cold start: `launch\start-meridian.cmd --no-open` exited 0, `/api/health` returned `{"ok":true,...,"uptimeSec":2}`, `index.html` and all 4 JS assets + CSS served 200, `/api/bootstrap` returned live state.
- Live behaviour on the running server: assistant `summary` returned real local counts; routine `inbox-watch` ran with an honest step log; `PUT /api/integrations/email-imap {status:"connected"}` was refused (409, "Configuration required").
- Desktop shortcut: `C:\Users\Admin\OneDrive\Desktop\Meridian OS.lnk`, target verified as `D:\General-Agentic-OS\launch\start-meridian.cmd` (read back from the .lnk after creation).
- Graceful shutdown: `launch\stop-meridian.cmd` printed "Server stopped." and the health endpoint stopped responding.

## What exists now

- `server/server.js` + `server/lib/{util,store,skills,routines,memory,provider}.js` — zero-dependency API + static server (binds 127.0.0.1 only).
- `public/` — command-centre UI: canvas particle core (adaptive, reduced-motion fallback), orbital navigation, six panel modules, five micro-apps, quick capture, search, toasts, settings.
- `data/` (created at first boot; gitignored) — JSON stores, skill/routine manifests, Markdown memory, logs. Example items are labelled and removable in Settings.
- `launch/` — start (single-click, already-running detection, failure reporting), stop (graceful), create-shortcut (idempotent).
- `test/server.test.js` — 15 tests. `README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `PLAN.md` (§8 records the stack decision), `CHANGELOG.md`.

## Honest limitations (not faked anywhere)

- Email/calendar integrations are registered but disconnected; the UI says so and the server refuses fake connection states.
- The assistant is a local deterministic command engine. No model provider is configured or used; Milestone 4 requires verified credentials and explicit approval.
- Routines run manually only; no background scheduler exists (deliberate, pending your approval).
- No git repository yet (Overseer prerequisite; `git init` left for your go-ahead since committing needs your request).

## Next steps (Milestone 2–3 polish → 4)

1. Run `npm test` and the desktop shortcut yourself; report anything visual to fix.
2. Skills: version history display, skill composition inside one routine (already partially demonstrated by morning-brief → daily-brief).
3. Memory review loop polish; activity-driven routine suggestions (suggestions only, never auto-created).
4. Milestone 4 provider integration only after you approve a provider and scope.

## Recovery note

Resume by reading `STATUS.md` → `PLAN.md` → `CHANGELOG.md`, then run `npm test` to confirm the baseline. All state lives in `data\`; restoring that folder restores the app.
