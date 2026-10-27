# General Agentic OS — Architecture

**Status:** Implemented and verified for Milestone 1 (browser-based).  
**Purpose:** Document the actual module boundaries, data flow, and security controls.

## 1. Architectural principles

- Local-first, browser-based, usable without external integrations.
- Small vertical slices; every milestone must be runnable and testable.
- Visible and inspectable workflow behavior rather than opaque autonomous execution.
- Skills, routines, memory, micro-apps, and provider integrations remain distinct modules with explicit interfaces.
- Server code is the trust boundary; browser renderer is untrusted.
- No feature is presented as connected or successful unless runtime state confirms it.
- Plain-text maps and files are the default for human-inspectable knowledge; a vector database is not a baseline requirement.

## 2. Actual system shape (Milestone 1 — browser-based)

```text
Windows Desktop Shortcut
          |
          v
launch/start-meridian.cmd (checks health, starts server, opens browser)
          |
          v
+------------------ Node.js HTTP Server (server/server.js) -----------------+
|  Binds 127.0.0.1:4780 only                                                |
|                                                                          |
|  +------------------ Static File Server ---------------------------------+|
|  |  Serves public/index.html, CSS, JS modules (vanilla, no build step)  ||
|  |  CSP headers on all responses                                        ||
|  +------------------|---------------------------------------------------+|
|                     |                                                    |
|  +------------------ HTTP API (/api/*) ----------------------------------+|
|  |  /api/health, /api/bootstrap                                         ||
|  |  /api/store/:name       — CRUD for collections (inbox, tasks, notes, ||
|  |                           docs, events, activity, runs, proposals)   ||
|  |  /api/skills            — List, import, invoke skills               ||
|  |  /api/routines          — List, run routines                        ||
|  |  /api/runs              — Routine execution history                  ||
|  |  /api/memory            — List, read, write, propose, approve       ||
|  |  /api/search            — Cross-store + memory search               ||
|  |  /api/settings          — App settings                               ||
|  |  /api/integrations      — Integration registry (honesty gate)       ||
|  |  /api/assistant         — Local deterministic command engine         ||
|  |  /api/open-data         — Open data folder (Windows, origin check)  ||
|  |  /api/shutdown          — Graceful shutdown (origin check)          ||
|  +------------------|---------------------------------------------------+|
|                     |                                                    |
|  +------------------ Core Libraries (server/lib/) -----------------------+|
|  |  util.js       — Atomic writes, safeJoin, redaction, IDs, dates     ||
|  |  store.js      — JSON file stores, in-memory cache, write queues,   ||
|  |                 optimistic concurrency (rev), backup recovery       ||
|  |  skills.js     — Skill validation, rendering, invocation            ||
|  |  routines.js   — Routine validation, execution, approval gates      ||
|  |  memory.js     — Markdown areas, proposals, capture                 ||
|  |  provider.js   — Local deterministic assistant (no external LLM)    ||
|  +---------------------------------------------------------------------+|
+--------------------------------------------------------------------------+
```

## 3. Main modules and responsibilities

### Browser renderer (public/)

Responsibilities:
- Render the command-centre layout, central visualization (canvas particle core), navigation (orbital), module panels, and visual states.
- Collect user input and display results/status returned by the HTTP API.
- Provide reduced-motion and lightweight visualization fallbacks (`prefers-reduced-motion`).
- All state fetched from `/api/bootstrap` and subsequent API calls.

Must not:
- Directly access arbitrary local files, operating-system APIs, credentials, or database handles.
- Treat client-side display state as proof that an operation succeeded.
- Invent live integration data.

### Node.js HTTP Server (server/server.js)

Responsibilities:
- Create and manage the HTTP server lifecycle (startup, health, graceful shutdown).
- Serve static assets with CSP headers.
- Expose narrowly scoped HTTP API endpoints with validation at every trust boundary.
- Own JSON file persistence, filesystem access, and privileged operations (e.g., opening Explorer).
- Validate Origin/Referer on sensitive endpoints (CSRF protection).
- Handle startup errors and controlled shutdown with write flush.

Security defaults:
- Binds `127.0.0.1` only.
- Restrictive CSP on all responses.
- Path traversal and symlink escape protection via `safeJoin`.
- Input validation: collection allow-list, payload size limits, JSON structure checks.
- Integration honesty gate: `connected` refused without configuration.
- Secret redaction in logs and error responses.

### Persistence layer (server/lib/store.js + JSON files)

- JSON files under `data/stores/*.json` for structured collections.
- In-memory authoritative cache with per-collection write queues for serialization.
- Optimistic concurrency control via `rev` counter (409 on stale update).
- Atomic writes: temp file + fsync + retrying rename + `.bak` fallback for recovery.
- Markdown files under `data/memory/` for inspectable memory areas.
- Skill/routine manifests as JSON files under `data/skills/` and `data/routines/`.

### Micro-apps (public/modules/*.js)

Five working micro-apps (all persist to JSON stores):
- **Quick Capture** — Inbox capture with triage to task/note.
- **Notes** — CRUD + search.
- **Tasks** — Add/toggle/delete + tabs (open/done).
- **Docs** — CRUD for skill artifacts and documents.
- **Routine Launcher** — Run routines, view history.

Only bundled, trusted micro-apps; no dynamic code loading.

### Skills service (server/lib/skills.js)

Responsibilities:
- Discover skills from `data/skills/`.
- Parse and validate metadata and required sections (schema, template, type).
- Present skills for inspection and selection via `/api/skills`.
- Invoke skills via `/api/skills/:id/invoke` with approval gate for self-triggered types.
- Keep skill instructions separate from privileged capabilities (templates only).
- Record selected skills and execution outcomes for auditability.

Imported skills are untrusted content. A skill can describe a workflow but cannot grant itself filesystem, shell, network, or account access.

### Memory service (server/lib/memory.js)

Responsibilities:
- Maintain concise indexes/maps and organized, inspectable memory areas (inbox, preferences, projects, reference, workflow).
- Separate temporary execution context from persistent user-approved memory.
- Support review, edit, export, archive, and delete operations.
- Propose changes via `/api/memory/propose`; require approval via `/api/memory/proposals/:id/approve` before applying.
- Record provenance and timestamps.

### Routines service (server/lib/routines.js)

Responsibilities:
- Represent routine definitions, status, input requirements, execution permissions, limits, and history.
- Support user-triggered execution via `/api/routines/:id/run`.
- Steps: query (filter collections), skill (invoke with approval gate), notify, notify-if (conditional).
- Approval gates for skills marked with `gate: true`.
- Daily run limits (`maxRunsPerDay`).
- Persistent history in `runs` collection.
- Explicit pause/disable behavior and truthful outcomes (success, failed, awaiting_approval, limit_reached).

No autonomous recurring routine is enabled by default.

### Integration/provider adapters

Provider-neutral interface for model/CLI/API interactions (scaffolded in `server/lib/provider.js` and `store.js` integrations registry).

External email/calendar integrations are optional. If not configured, display a clear disconnected state. Requests containing private content must not be sent externally unless the user has configured and authorized the relevant integration.

No separate Express API or WebSocket server in Milestone 1. The HTTP server is the backend. If a local network service is later justified, bind only as narrowly as possible, add authentication/origin protections as appropriate, and document its threat model.

## 4. Data flow examples

### Saving a note

1. Renderer validates basic form state and calls a specific exposed IPC method.
2. Main process validates the payload again and applies length/type limits.
3. Notes service writes the record through the persistence layer.
4. Main process returns the saved result or a structured error.
5. Renderer updates the UI only from that result.

### Running a skill

1. User inspects and selects an approved skill.
2. Skills service loads the definition from an approved root and validates the manifest.
3. Workflow planner identifies required inputs, tools, and permission needs.
4. Any privileged or external capability must be separately allow-listed and, when consequential, approved.
5. Execution records selected skill IDs, result status, and redacted diagnostics.
6. Results are presented without claiming success unless verified.

### Running a routine

1. User explicitly starts an enabled routine.
2. Routine service checks authorization, input requirements, concurrency limits, and budgets.
3. The executor invokes only approved steps.
4. Result/status is saved to history; failures and cancellation are represented distinctly.
5. Future scheduling or passive monitoring requires explicit setup and disable controls.

## 5. Model and context management

- Make provider/model choice explicit in configuration and execution records.
- Verify actual model IDs, available context, output limits, rate limits, and API compatibility independently; do not infer availability from an alias or marketing page.
- Bound requests and output sizes, handle cancellation/timeouts where supported, and save checkpoints before expensive or lengthy work.
- Do not automatically switch to a paid provider or send data to another service during fallback.
- Do not use a context limit as a substitute for task/checkpoint discipline.

## 6. Observability and recovery

- Structured local logs with secrets and sensitive payloads redacted.
- Persistent workflow/run status with `queued`, `running`, `succeeded`, `failed`, and `cancelled` states as appropriate to actual capabilities.
- Explicit timestamps and error categories.
- Safe startup diagnostics and actionable messages.
- Versioned data migrations and documented backup/recovery procedures.
- A project-level `STATUS.md` checkpoint at each meaningful milestone.

## 7. Decisions intentionally deferred

- Whether remote synchronization is needed.
- Which email/calendar providers, if any, the user wants to connect.
- Background scheduling beyond explicit, user-authorized routines.
- Vector search or embeddings.
- Separate backend server, WebSockets, external queue, or multi-process architecture.
- Dynamic downloadable/executable micro-apps.

Each deferred item requires a concrete use case, security implications, and an acceptance test before implementation.
