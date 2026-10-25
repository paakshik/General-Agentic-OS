# General Agentic OS — Architecture

**Status:** Proposed architecture for Milestone 0; not yet verified against a created application.  
**Purpose:** Define module boundaries, data flow, and safe evolution without prematurely introducing infrastructure.

## 1. Architectural principles

- Local-first, desktop-oriented, and usable without external integrations.
- Small vertical slices; every milestone must be runnable and testable.
- Visible and inspectable workflow behavior rather than opaque autonomous execution.
- Skills, routines, memory, micro-apps, and provider integrations remain distinct modules with explicit interfaces.
- Renderer code is untrusted relative to the Electron main process.
- No feature is presented as connected or successful unless runtime state confirms it.
- Plain-text maps and files are the default for human-inspectable knowledge; a vector database is not a baseline requirement.

## 2. Proposed system shape

```text
Windows Desktop Shortcut
          |
          v
Project-local launcher / Electron runtime
          |
          +---------------- Electron Main Process ----------------+
          |                                                       |
          |  Window lifecycle and security                         |
          |  Typed, allow-listed IPC handlers                     |
          |  Local data/repository services                       |
          |  SQLite access and migrations                         |
          |  Skill loading/validation                              |
          |  Routine execution controls                           |
          |  Provider/integration adapters (optional)              |
          |                                                       |
          +----------------------|--------------------------------+
                                 | contextBridge + typed IPC
                                 v
                    React + TypeScript Renderer
                                 |
              +------------------+-------------------+
              |                  |                   |
        Command Centre       Micro-Apps         Module pages
        - central core       - quick capture    - Skills
        - orbital nav        - notes            - Memory
        - activity           - tasks/follow-up  - Routines
        - email/calendar     - reports          - Settings
```

This is a proposed boundary, not a statement that these modules already exist. The Maker should update it if the inspected environment or a concrete requirement warrants another design.

## 3. Main modules and responsibilities

### Renderer / command centre

Responsibilities:
- Render the command-centre layout, central visualization, navigation, module panels, and visual states.
- Collect user input and display results/status returned by approved main-process services.
- Provide reduced-motion and lightweight visualization fallbacks.

Must not:
- Directly access arbitrary local files, operating-system APIs, credentials, or database handles.
- Treat client-side display state as proof that an operation succeeded.
- invent live integration data.

### Electron main process and preload bridge

Responsibilities:
- Create and manage the application window and process lifecycle.
- Expose only documented, narrowly scoped IPC methods from the preload script using `contextBridge`.
- Validate IPC arguments and enforce permissions at the main-process boundary.
- Own database access, filesystem access, and privileged integrations.
- Handle startup errors and controlled shutdown.

Security defaults:
- `nodeIntegration: false` in renderer contexts.
- `contextIsolation: true`.
- Use a restrictive Content Security Policy appropriate to the chosen build setup.
- Avoid exposing a generic `exec`, arbitrary path read/write, or unrestricted IPC method to the renderer.

### Persistence layer

Proposed SQLite database for structured data such as micro-app items, routine metadata/run history, settings, and skill metadata. Access it only through main-process services. Use versioned migrations and a documented backup/recovery method.

Store Markdown/text skill definitions and memory maps as files in an app-owned data directory where this improves portability and inspectability. Database records may index these files, but must not silently become the sole copy of user content.

The Maker must verify the selected driver's Electron compatibility and packaging requirements before committing to it.

### Micro-app registry

Each micro-app should expose metadata (stable ID, display name, description, version, entry point, permissions, and capability declaration) and a known set of UI and service capabilities. Initial micro-apps should be trusted, bundled application modules, not arbitrary downloaded code.

First candidates:
- Quick capture/inbox.
- Notes and searchable knowledge.
- Tasks and follow-ups.
- Document/report workspace.

Only ship a micro-app when its core action, state, persistence, and failure states work.

### Skills service

Responsibilities:
- Discover skills from approved roots.
- Parse and validate metadata and required sections.
- Present skills for inspection and selection.
- Compose only compatible, explicitly selected or appropriately suggested skills.
- Keep skill instructions separate from privileged capabilities.
- Record selected skills and execution outcomes for auditability.

Imported skills are untrusted content. A skill can describe a workflow but cannot grant itself filesystem, shell, network, or account access.

### Memory service

Responsibilities:
- Maintain concise indexes/maps and organized, inspectable memory areas.
- Separate temporary execution context from persistent user-approved memory.
- Support review, edit, export, archive, and delete operations.
- Record provenance and timestamps where practical.
- Store feedback as a pending note or proposal; require user approval before calibrating/promoting it into a durable skill or memory rule.

### Routines service

Responsibilities:
- Represent routine definitions, status, input requirements, execution permissions, limits, and history.
- Support user-triggered execution first.
- Expose explicit pause/disable behavior and truthful outcomes.
- Add passive monitoring or scheduling only after the user approves trigger sources, frequency, resource bounds, and behavior on failure.

No autonomous recurring routine is enabled by default.

### Integration/provider adapters

Use a provider-neutral interface for model/CLI/API interactions. Track provider identity, configured status, permissions, and supported capabilities. Confirm identifiers and endpoint compatibility in the live environment before declaring an adapter operational.

External email/calendar integrations are optional. If they are not configured, display a clear disconnected state rather than simulated live data. Requests containing private content must not be sent externally unless the user has configured and authorized the relevant integration.

Do not create a separate Express API or WebSocket server in the first milestone without a demonstrated requirement. Typed IPC is the default local boundary. If a local network service is later justified, bind only as narrowly as possible, add authentication/origin protections as appropriate, and document its threat model.

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
