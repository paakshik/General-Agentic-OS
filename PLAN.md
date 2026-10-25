# General Agentic OS — Project Plan

**Project directory:** `D:\General-Agentic-OS`  
**Current milestone:** Milestone 0 — discovery, architecture, and acceptance criteria  
**Document status:** Initial planning proposal; implementation and runtime behavior are not yet verified.

## 1. Product goal

Build a local-first, general-purpose Agentic OS presented as a futuristic virtual command centre. It is intended for personal and professional workflows: reusable skills, routines, inspectable memory, connected applications, and small workflow-specific micro-apps.

The supplied RUBRIC Agentic OS screenshot is a visual reference for layout and atmosphere, not a source-code dependency. The ARMS V2 guide provides the conceptual framework: **Apps, Routines, Memory, and Skills**. Implement useful levels progressively; do not attempt to implement all advanced ideas before the core application is stable.

This project is separate from `D:\Coding-Agentic-OS` (coding-task workspace) and `D:\nim-claude` (existing Claude/NVIDIA/LiteLLM setup).

## 2. Proposed stack and selection rationale

The Maker must verify the installed Node.js/npm environment and choose stable, mutually compatible versions when creating the project. Pin dependencies in the resulting lockfile. Do not assume that any package or version is already installed.

| Area | Proposed choice | Rationale / constraint |
|---|---|---|
| Desktop shell | Electron | Supports a Windows desktop application and desktop shortcut. |
| Renderer | React + TypeScript + Vite | Fast iteration for a rich, componentized command-centre UI. |
| Styling | CSS variables and component-level styles; use Tailwind only if it reduces rather than adds complexity | Supports a consistent dark visual system, responsive layouts, and restrained orange accents. |
| Main/renderer boundary | Electron preload + `contextBridge` + narrowly allow-listed IPC | Avoid exposing Node.js or unrestricted filesystem access to the renderer. |
| Local persistence | SQLite accessed only from the main process; prefer a maintained Node/Electron-compatible driver | Durable, queryable local storage without requiring a separately managed database service. Verify Electron native-module compatibility before committing. |
| Input validation | TypeScript types plus runtime validation at trust boundaries (for example, Zod if justified) | Static types do not validate untrusted runtime data. |
| Tests | Unit tests for pure logic; integration tests for persistence and IPC; a documented Electron launch/smoke test | Verify behavior rather than relying on visual inspection or documentation. |
| Skills and memory files | Portable Markdown/text files under an app-owned data directory, with metadata/indexes as needed | Makes content inspectable and exportable; no vector database is required for the initial release. |
| Provider integrations | Optional adapters behind a common interface | Avoid coupling the app to a single model provider or assuming a model endpoint exists. |

**Architecture decision:** do not add an Express server, WebSocket server, vector database, job queue, or always-running background service in Milestone 1 unless implementation evidence demonstrates that it is necessary. Prefer secure Electron IPC first. Revisit this decision only with a documented use case.

## 3. Visual and interaction requirements

The main screen should evoke a futuristic command centre:

- Near-black background, subtle graphite surfaces, legible white/grey typography, restrained orange accents, fine dividers, and polished but modest motion.
- Central intelligence visualization with a static or reduced-motion fallback.
- Circular/orbital navigation or an equally intentional navigation treatment around the central area.
- Functional panels for Micro Apps, Calendar, Email, Skills Deck, and Routines; an activity/quick-capture panel is also appropriate.
- Readable at common desktop resolutions; responsive behavior for narrower screens.
- Every panel must have useful loading, empty, disconnected, and error states where applicable.
- No fake emails, events, connected accounts, agent runs, analytics, or success states. Use clearly labelled sample/local data only where required to demonstrate a feature.

## 4. Functional scope by milestone

### Milestone 0 — discovery and design

Deliverables:
- `PLAN.md`
- `STATUS.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `CHANGELOG.md`

Acceptance criteria:
- Proposed stack, boundaries, module responsibilities, risks, and staged acceptance criteria are documented.
- Existing machine/project state is inspected before implementation.
- No unrelated project or global configuration is modified.

### Milestone 1 — usable command centre

Implement:
- Desktop shell, application window, navigation, central visualization, and cohesive design system.
- Micro-app gallery with a few genuinely functional local starter tools: quick capture/inbox, notes/knowledge, task/follow-up manager, and a simple document/report workspace.
- App settings and a truthful integration registry with disconnected states.
- Persistent local storage for the starter workflows.
- One-click Windows desktop shortcut and project-local launcher; no manual terminal startup required for ordinary use.

Acceptance criteria:
- A cold start from the desktop shortcut opens the app without manually launching PowerShell or starting multiple servers.
- Navigation and each included starter micro-app works end-to-end.
- Data survives application restart.
- The renderer is not given unrestricted Node.js or filesystem access.
- Startup errors are surfaced clearly and no unnecessary process is left running.

### Milestone 2 — Skills and Memory

Implement:
- Searchable Skills Library with reference/database, artifact, and self-triggered skill types.
- Inspectable skill definitions, metadata, version history or change history, input/output expectations, and safe loading.
- A bounded workflow in which one or more chosen skills measurably influence execution.
- Inspectable/editable persistent memory and plain-text maps/indexes.
- User-controlled feedback capture and approval-based calibration; no silent self-modification.

Acceptance criteria:
- A test demonstrates that selecting a skill changes the actual workflow behavior or output.
- Imported skill instructions are treated as untrusted content and cannot silently grant additional privileges.
- Memory updates survive restart and can be inspected/edited by the user.

### Milestone 3 — Routines

Implement:
- Manual routines with visible status, results, logs, and persistent history.
- Active/passive routine concepts with explicit enablement and permission boundaries.
- Execution limits and measurable cost/token tracking where available.
- Suggestions for repetitive-work automation, requiring user approval before creation or activation.

Acceptance criteria:
- A routine produces a verifiable outcome and history records survive restart.
- Failure, cancellation, and incomplete execution are represented honestly.
- No recurring or background routine starts unexpectedly.

### Milestone 4 — verified agent and app integrations

- Verify the real provider/CLI/API, model identifier, authentication path, and required permissions before integration.
- Add one useful integration only when credentials and permissions are explicitly provided.
- Keep provider-specific logic behind an adapter and disclose what data leaves the device.
- Never silently route to a paid provider or claim a disconnected service is live.

Acceptance criteria:
- At least one harmless bounded workflow executes through a verified provider, if the user has configured one.
- UI status, errors, cancellation (where supported), and execution history match observed outcomes.

### Milestone 5 — reliability and polish

- Complete tests, security review, launcher/restart checks, responsive and reduced-motion checks, recovery guidance, and documentation.
- Fix verified defects before adding new features.

## 5. Definition of done for the first usable release

1. Desktop shortcut reliably launches the application from a cold start.
2. Command-centre UI reflects the visual direction and remains readable.
3. Navigation and the included micro-apps work, not merely render.
4. Local data persists across restart.
5. Empty, error, loading, and disconnected states are implemented where relevant.
6. Security boundaries for renderer, local files, imported skills, and secrets are documented and tested where practical.
7. Tests and setup/recovery documentation exist.
8. Existing unrelated paths and global configuration remain untouched.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Overbuilding every ARMS level immediately | Deliver one verified vertical slice per milestone; defer speculative features. |
| Electron/native database compatibility issues | Verify the driver, Electron ABI, packaging, and migration process early. Keep DB access in the main process. |
| Attractive static mockup mistaken for a working app | Require end-to-end acceptance checks and persisted state. |
| Model/provider availability or rate limits | Provider abstraction, verified identifiers, bounded requests, saved checkpoints, and honest unavailable states. |
| Excessive permissions through skills or connectors | Treat imported content as untrusted, use explicit allow-lists, and require approval for consequential actions. |
| Secret leakage | Keep secrets out of renderer state, source control, logs, and reports; use local protected configuration where needed. |
| Background routines consuming resources or acting unexpectedly | No unattended routines by default; explicit activation, limits, logs, and pause controls. |
| Concurrent agent edits | Maker owns implementation; Overseer audits read-only except for its explicitly authorized audit/documentation artifacts. Coordinate changes to shared files. |

## 7. Dependency and operational policy

- Inspect installed runtime and available tools first.
- Avoid new dependencies unless they have a clear purpose and are actively maintained.
- Pin versions through the package manager lockfile.
- Do not install global tools, elevate privileges, change global configuration, or configure external services without justification and user approval where needed.
- Never put credentials in source files, test fixtures, logs, or committed examples.
- Keep project state recoverable at checkpoints. Update `STATUS.md`, `PLAN.md`, and `CHANGELOG.md` as work advances.
