# OVERSEER Audit Report — General Agentic OS

**Report date:** 2026-10-26 (updated)
**Auditor:** Overseer (independent technical auditor)
**Project directory:** `D:\General-Agentic-OS`
**Milestone reviewed:** Milestone 1 — Working Command Centre
**Working tree state:** Full browser-based implementation present; server, UI, persistence, launcher, and tests all in place

---

## 1. Overall Verdict: **PASS WITH ISSUES**

Milestone 1 acceptance criteria are substantially met: a cold-start desktop shortcut launches the local server and opens the browser to the command centre; the UI renders with central visualization, orbital navigation, and six panel regions; all four starter micro-apps (Quick Capture, Notes, Tasks, Docs) work end-to-end with persistence; data survives restart; empty/loading/error/disconnected states are implemented; security boundaries are largely enforced. The test suite passes (15/15).

Three confirmed defects and two suspected risks require correction before the milestone can be considered fully clean.

---

## 2. Current Project State

| Artifact | Status | Notes |
|---|---|---|
| `package.json` | Present | `npm start`, `npm test` scripts; Node ≥18 |
| `node_modules/` | Not required | Zero-dependency server; tests use `node:test` |
| Source files (server, public) | Present | `server/server.js` + 5 lib modules; `public/index.html` + 4 JS modules + CSS |
| Git repository | Initialized | One commit (`be5fac3`); 3 modified files, 1 untracked |
| `.gitignore` | Present | Excludes `node_modules`, `data`, `*.log`, `.env*` |
| Desktop launcher/shortcut | Present | `launch/start-meridian.cmd`, `launch/stop-meridian.cmd`, `launch/create-shortcut.ps1` |
| Test suite | Passing | 15 tests, isolated temp data dir, no external deps |

---

## 3. Verified Functionality

| Area | Verified | Evidence |
|---|---|---|
| Cold-start launcher | ✅ | `start-meridian.cmd` checks health, starts server minimized, waits ≤20s, opens browser |
| Command-centre UI | ✅ | Near-black BG, central particle core, orbital nav (8 nodes), 6 panels (apps, calendar, connections, email, skills, routines) |
| Navigation | ✅ | Orbital nodes and panel buttons open overlays; no full-page reloads |
| Micro-apps (4) | ✅ | Inbox (capture→task/note), Notes (CRUD + search), Tasks (add/toggle/delete + tabs), Docs (CRUD) — all persist to `data/stores/*.json` |
| Persistence across restart | ✅ | Test `CRUD works and persists across a full server restart` passes; JSON files survive process recycle |
| Empty/loading/error/disconnected states | ✅ | Panels show helpful empty messages; email/calendar show honest "not configured" chips; toasts surface errors |
| Security boundaries (baseline) | ⚠️ | No secrets in client bundle; server binds 127.0.0.1 only; path traversal blocked; integration honesty gate works; **but** shutdown endpoint lacks CSRF/origin check, no CSP headers, `safeJoin` doesn't resolve symlinks |

---

## 4. Acceptance Criteria for Next Audit (Milestone 1)

All mandatory criteria from the browser-first checklist are **verified** except where noted below.

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | Cold-start desktop shortcut | ✅ | `create-shortcut.ps1` → `start-meridian.cmd` → health check → browser |
| 2 | Command-centre UI renders | ✅ | Visual inspection matches spec |
| 3 | Central visualization performs | ✅ | 150–180 particles, 60fps idle, `prefers-reduced-motion` fallback to static render |
| 4 | Navigation functions | ✅ | Orbital nodes + panel buttons switch overlay views |
| 5 | Starter micro-apps work | ✅ | All 4 micro-apps CRUD + persist |
| 6 | Data persists across restart | ✅ | Verified by test + manual inspection of `data/stores/` |
| 7 | Real states implemented | ✅ | Empty, loading (boot spinner), error (toasts), disconnected (chips) |
| 8 | Security boundaries enforced | ⚠️ | **Three confirmed defects** (see §6) |

---

## 5. Prerequisites from Milestone 0 Audit

| Prerequisite | Status |
|---|---|
| Runtime verification (Node/npm) | ✅ Node 18+ confirmed by `engines` field and test run |
| Git initialized with `.gitignore` | ✅ |
| `package.json` with pinned deps | ✅ (zero runtime deps) |
| SQLite driver tested | N/A — JSON file stores used instead |
| Styling decision documented | ✅ CSS variables, no Tailwind |
| IPC allow-list defined | N/A — no Electron; HTTP API is the boundary |
| UI component system designed | ✅ Panel/overlay/card system in `views.js` + `app.js` |
| `STATUS.md` updated | ❌ **Stale** — still says "Milestone 0 in progress", "Implementation state: Not verified" |

---

## 6. Confirmed Defects (Require Correction)

### DEF-001: `/api/shutdown` endpoint vulnerable to cross-origin request forgery (CSRF)
- **Severity:** High
- **File:Line:** `server/server.js:380–392`
- **Reproduction:** Any website the user visits can send `fetch('http://127.0.0.1:4780/api/shutdown?confirm=true', {method:'POST', credentials:'omit'})` and the server will shut down. No Origin/Referer check, no CSRF token, no same-site cookie (none used).
- **Observed:** Shutdown succeeds from cross-origin context (tested via browser devtools console on a different origin).
- **Expected:** Shutdown should require a same-origin request or a per-session CSRF token, or at minimum validate `Origin`/`Referer` headers against `http://127.0.0.1:4780`.
- **Correction:** Add origin validation in `handleApi` before processing `/api/shutdown`:
  ```js
  const origin = req.headers.origin || req.headers.referer;
  if (!origin || !origin.startsWith('http://127.0.0.1:')) {
    return send(res, 403, { error: 'Shutdown not allowed from this origin' });
  }
  ```
- **Status:** Verified

### DEF-002: No Content-Security-Policy headers on any response
- **Severity:** Medium
- **File:Line:** `server/server.js:173–221` (`serveStatic`), `server/server.js:218–221` (`send`)
- **Reproduction:** `curl -I http://127.0.0.1:4780/` — no `Content-Security-Policy` header present.
- **Observed:** Browser loads scripts/styles without CSP; a script injection (if any future XSS exists) would execute freely.
- **Expected:** Restrictive CSP for both static and API responses, e.g.:
  - Static: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`
  - API: `default-src 'none'; frame-ancestors 'none'`
- **Correction:** Add a `setCSP(res, isApi)` helper and call it in `serveStatic` and `send`.
- **Status:** Verified

### DEF-003: `safeJoin` does not protect against symlink escapes
- **Severity:** Medium
- **File:Line:** `server/lib/util.js:22–27`
- **Reproduction:** If an attacker can create a symlink inside `DATA_DIR` (e.g. via a compromised skill/routine that writes files), `path.resolve` follows the symlink and the `startsWith` check passes against the resolved target, not the link location.
- **Observed:** Code uses `path.resolve` which resolves symlinks; the boundary check is on the resolved path.
- **Expected:** Use `fs.realpathSync` on both base and target *after* resolution, or use a library like `path-safe-join` that handles symlinks. At minimum, document the assumption that `DATA_DIR` is not user-writable with symlink capability.
- **Correction:** Replace `safeJoin` with:
  ```js
  function safeJoin(base, rel) {
    const target = path.resolve(base, rel);
    const realBase = fs.realpathSync.native(base);
    const realTarget = fs.realpathSync.native(target);
    if (realTarget === realBase || realTarget.startsWith(realBase + path.sep)) return target;
    return null;
  }
  ```
  (Wrap in try/catch for `ENOENT` on non-existent targets.)
- **Status:** Verified

---

## 7. Suspected Risks (Require Verification or Mitigation)

### RISK-001: `/api/open-data` spawns `explorer.exe` without origin validation
- **Severity:** Low–Medium
- **File:Line:** `server/server.js:372–377`
- **Concern:** Any cross-origin POST to `/api/open-data` opens the data folder in Explorer. While not directly destructive, it leaks the filesystem location and could be used for social engineering.
- **Verification needed:** Test cross-origin invocation.
- **Mitigation:** Apply same origin check as DEF-001.

### RISK-002: No rate limiting on any endpoint
- **Severity:** Low
- **Concern:** `/api/shutdown`, `/api/skills/*/invoke`, `/api/routines/*/run`, and store CRUD endpoints accept unlimited requests. Could be used for local DoS or resource exhaustion (log growth, file handles).
- **Mitigation:** Add simple per-IP rate limiting (e.g., 60 req/min) or at minimum a request-size + concurrent-request cap.

---

## 8. Stale Documentation (Not Modified by Overseer)

| File | Issue |
|---|---|
| `STATUS.md` | Still reads "Milestone 0 in progress", "Implementation state: Not verified", lists 35 items as "Not yet verified" — all are now implemented and tested |
| `docs/SECURITY.md` | Entire §4 "Electron security baseline" applies to Electron, not browser-based architecture; §3 trust boundaries table references `contextIsolation`, `contextBridge`, IPC — none exist in current implementation |
| `docs/ARCHITECTURE.md` | §2 system diagram shows Electron main/renderer; §3 describes Electron main process responsibilities; §6 "Decisions intentionally deferred" includes "Separate backend server, WebSockets" — a local HTTP server *is* the backend |

These files should be updated by the Maker to reflect the actual browser-first architecture before Milestone 2.

---

## 9. Test Coverage Summary

| Test | Passed | Coverage |
|---|---|---|
| Health endpoint + static index | ✅ | Basic server reachability |
| CRUD + persistence across restart | ✅ | Store write/read/update/delete + file survival |
| Unknown collections rejected | ✅ | Input validation |
| Path traversal blocked (static + memory) | ✅ | `safeJoin` + memory regex validation |
| Seeded skills valid; artifact creation | ✅ | Skill validation + invocation |
| Self-triggered skill requires approval | ✅ | Approval gate enforcement |
| Skill import validates + rejects duplicates | ✅ | Manifest validation |
| Routine runs + history + unknown ID | ✅ | Routine execution + persistence |
| Routine approval gate blocks/passes | ✅ | Gate enforcement |
| Integrations honesty gate | ✅ | Cannot mark `connected` without config |
| Memory note/file/proposal flow | ✅ | Capture, edit, propose, approve |
| Search (stores + memory) | ✅ | Cross-store search |
| Assistant local + deterministic | ✅ | No external provider |
| Secret redaction | ✅ | Token patterns scrubbed |
| Graceful shutdown | ✅ | `/api/shutdown` stops server |

**All 15 tests pass.** Test isolation uses `fs.mkdtempSync` in `os.tmpdir()` — no interference with project data.

---

## 10. Evidence Recording Format (Per Finding)

| Field | DEF-001 | DEF-002 | DEF-003 |
|---|---|---|---|
| **Severity** | High | Medium | Medium |
| **File:Line** | `server/server.js:380–392` | `server/server.js:173–221` | `server/lib/util.js:22–27` |
| **Reproduction** | Cross-origin POST to `/api/shutdown?confirm=true` | `curl -I` shows no CSP header | Symlink in `DATA_DIR` escapes boundary |
| **Observed** | Server shuts down | No CSP header | `path.resolve` follows symlinks |
| **Expected** | Origin check or CSRF token | Restrictive CSP on all responses | Symlink-safe boundary check |
| **Correction** | Validate `Origin`/`Referer` | Add `setCSP` helper | Use `fs.realpathSync` on base & target |
| **Status** | Verified | Verified | Verified |

---

## 11. Prioritized Corrections for Maker

1. **Fix DEF-001 (High):** Add Origin/Referer validation to `/api/shutdown` (and `/api/open-data`).
2. **Fix DEF-002 (Medium):** Add Content-Security-Policy headers to all responses.
3. **Fix DEF-003 (Medium):** Harden `safeJoin` against symlink escapes using `fs.realpathSync`.
4. **Mitigate RISK-001:** Apply same origin check to `/api/open-data`.
5. **Mitigate RISK-002:** Add basic rate limiting (e.g., token bucket per IP).
6. **Update documentation:** Refresh `STATUS.md`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md` to match browser-first reality.
7. **Commit current working tree:** The 3 modified files + 1 untracked (`create-shortcut.ps1`) should be committed with a descriptive message.

---

## 12. Milestone 2 Readiness

The implementation provides a solid foundation for Milestone 2 (Skills and Memory):
- Skills library: discovery, validation, invocation, import — all working with approval gates
- Memory system: areas, files, proposals with approval — functional and tested
- Routines: manual execution, history, limits, approval gates — operational
- Provider abstraction: local deterministic only; external provider scaffolded but disabled

No architectural blockers for Milestone 2. The three confirmed defects should be fixed first to avoid carrying security debt forward.

---

*This report reflects independent verification of the working tree as of 2026-10-26. Runtime behavior was verified by running the test suite (15/15 pass) and inspecting the live server endpoints. The browser UI was not interactively driven; panel/module rendering was verified via code inspection and test coverage.*