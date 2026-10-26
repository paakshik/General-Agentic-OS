# Meridian OS

A local-first, browser-based command centre for personal and professional workflows. Built as a zero-dependency Node.js server with a vanilla JavaScript UI.

**Product name:** Meridian OS  
**Repository:** General-Agentic-OS  
**Package:** `meridian-os` (private, UNLICENSED)

## Quick Start

### Requirements
- Node.js 20+ (tested on v24.11.0)
- Windows 10/11 (launcher scripts are Windows-specific; the server runs on any platform)

### Install & Run

```bash
# No npm install needed — zero dependencies by design
npm start
```

Or use the **desktop shortcut** (created by `launch/create-shortcut.ps1`):
1. Right-click `launch/create-shortcut.ps1` → "Run with PowerShell"
2. Click the "Meridian OS" shortcut on your Desktop

The app opens at `http://127.0.0.1:4780` in your default browser.

### Test
```bash
npm test
```
Runs 15 built-in tests using `node:test` (no test framework dependencies).

## Architecture

| Component | Technology |
|-----------|------------|
| Server | Zero-dependency Node.js HTTP server (`server/server.js`) |
| Persistence | JSON files under `data/` (atomic temp-file + rename writes) |
| Frontend | Vanilla JS + hand-written CSS, canvas particle core |
| Binding | `127.0.0.1:4780` only (no external network exposure) |
| Launch | `launch/start-meridian.cmd` — single-click, already-running detection, health wait |

### Project Layout
```
General-Agentic-OS/
├── server/
│   ├── server.js           # Main HTTP server + routing
│   └── lib/
│       ├── util.js         # Redaction, atomic writes, path safety, IDs
│       ├── store.js        # JSON collections (CRUD, settings, integrations)
│       ├── skills.js       # Skill manifests, validation, invocation
│       ├── routines.js     # Routine definitions, execution, history
│       ├── memory.js       # Markdown memory files (areas + proposals)
│       └── provider.js     # Local deterministic assistant (provider abstraction)
├── public/
│   ├── index.html          # Shell with orbital navigation
│   ├── css/app.css         # Design system (dark, orange accent, reduced-motion)
│   └── js/
│       ├── api.js          # Fetch helpers, toasts, HTML escaping
│       ├── core.js         # Particle visualization (pauses when hidden)
│       ├── views.js        # Module & micro-app renderers
│       └── app.js          # Boot, state, panels, overlay, dock
├── launch/
│   ├── start-meridian.cmd  # Starts server, waits for health, opens browser
│   ├── stop-meridian.cmd   # Graceful shutdown via /api/shutdown
│   └── create-shortcut.ps1 # Creates Desktop shortcut
├── test/
│   └── server.test.js      # 15 tests (health, CRUD, skills, routines, memory, security)
├── data/                   # Created at first boot (gitignored)
│   ├── stores/             # JSON collections
│   ├── skills/             # Skill manifests (.json)
│   ├── routines/           # Routine manifests (.json)
│   ├── memory/             # Markdown files (areas + 00-INDEX.md)
│   └── logs/               # server.log
├── docs/
│   ├── ARCHITECTURE.md
│   └── SECURITY.md
├── PLAN.md                 # Milestones & acceptance criteria
├── STATUS.md               # Verified runtime facts
├── CHANGELOG.md
├── package.json
└── config.example.json     # {"port": 4780}
```

## Features

- **Micro Apps** — Quick Capture, Notes, Tasks, Docs, Launcher (run routines)
- **Skills Deck** — Reference, Artifact, and Self-triggered skills with validation
- **Routines** — Multi-step workflows with approval gates, persistent history
- **Memory** — Area-based Markdown files with proposal/approval workflow
- **Calendar** — Local events (no external sync until configured)
- **Connections** — Honest integration registry (email, calendar, AI — all disconnected by default)
- **Assistant** — Local deterministic command engine (`help`, `capture`, `note`, `run`, `invoke`, `search`, `summary`)
- **Activity** — Append-only log of real actions
- **Search** — Cross-store and memory search

## Configuration

- **Port:** Default 4780. Override with `--port <n>` or `config.example.json`.
- **Data directory:** Default `./data`. Override with `--data <path>`.
- **Settings:** Stored in `data/stores/settings.json` (name, version, shell, port, accent).

## Backup & Restore

All state lives in `data/`. To back up:
```bash
# Copy the entire data folder
xcopy /E /I data data-backup-$(date +%F)
```
To restore: replace `data/` with your backup and restart.

## Security Model

- Server binds to `127.0.0.1` only — no external network exposure
- No CORS headers; `Origin` and `Host` validation on `/api/*` routes
- Per-launch API token injected into `index.html` (required on all `/api/*` calls)
- Strict CSP: `default-src 'self'; script-src 'self'; style-src 'self'; ...`
- All user content escaped at render sinks (`api.js:esc()`)
- Path traversal blocked via `safeJoin()` (canonicalization + realpath)
- Secrets redacted from logs (`util.js:redactSecrets()`)
- Imported skills are **data only** — never executed as code

See `docs/SECURITY.md` for the full threat model.

## Documentation

- `PLAN.md` — Milestones, acceptance criteria, stack decision record
- `STATUS.md` — Verified runtime facts (run `npm test` to confirm)
- `docs/ARCHITECTURE.md` — Module responsibilities, data flows
- `docs/SECURITY.md` — Threat model, trust boundaries, test plan

## License

UNLICENSED — private use only. See `package.json`.