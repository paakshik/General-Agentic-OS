# General Agentic OS — Security and Privacy

**Status:** Initial threat model; must be kept aligned with the implementation.  
**Scope:** Desktop app, local data, skills, routines, model/CLI integrations, and optional external services.

## 1. Security objectives

- Keep the application usable without granting broad system privileges.
- Keep renderer/UI code separate from privileged operating-system capabilities.
- Protect local notes, memory, settings, tokens, and integration data from accidental exposure.
- Prevent imported skill or micro-app content from silently gaining access to files, shell commands, networks, or accounts.
- Require explicit authorization for external data transfer and consequential actions.
- Make execution, errors, and permissions visible and auditable.

## 2. Assets to protect

- OAuth tokens, API keys, provider credentials, and session tokens.
- User notes, task content, memory, imported documents, and report artifacts.
- Email and calendar contents, if integrated.
- Skill definitions, routine definitions, and execution history.
- Filesystem contents and repository/project data reachable from connected tools.
- Local database contents, backups, logs, and settings.
- Integrity of app updates, packaged code, and integration adapters.

## 3. Trust boundaries and principal threats

| Boundary | Threat | Required control |
|---|---|---|
| Renderer -> main process | Malicious renderer content invokes privileged operations | `contextIsolation: true`, `nodeIntegration: false`, narrow `contextBridge`, typed allow-listed IPC, strict argument validation. |
| Skill/imported file -> skill executor | Prompt injection, path traversal, malicious metadata, unexpected execution | Treat content as untrusted; parse safely; restrict roots; separate instructions from capabilities; never evaluate imported code by default. |
| Routine -> local or external action | Unexpected repeated or consequential action | User activation, scoped permissions, visible run history, concurrency/time/cost limits, confirmation gates, pause/disable. |
| App -> filesystem | Reading/writing arbitrary paths or escaping app data root | Main-process path allow-lists, canonicalization/realpath checks, traversal and symlink handling, least privilege. |
| App -> shell/CLI | Command injection or excessive permissions | No arbitrary shell endpoint in renderer; fixed executables/argument arrays, allow-listed operations, bounded timeouts, clear approval policy. Avoid shell string concatenation. |
| App -> model/provider | Sensitive data leakage, unexpected provider/cost, invalid model routing | Explicit provider configuration, disclosure of transmitted data, bounded payloads, no silent paid fallback, redacted logs. |
| App -> external app API | Overbroad OAuth scopes or accidental writes | Minimal scopes, read-only first where useful, explicit write/action approvals, disconnect and revoke instructions. |
| Local storage/logs | Credentials or private content exposed | Keep secrets out of source control and ordinary logs; redact request bodies and headers; limit log retention and file permissions where practical. |
| Dependency/build chain | Vulnerable or compromised package | Minimal dependencies, lockfile, review lifecycle scripts and native modules, update intentionally, verify packaging. |

## 4. Browser-based security baseline

The application runs as a local HTTP server (Node.js, zero dependencies) bound to `127.0.0.1` only, serving a vanilla JS frontend. The browser tab is the renderer; there is no Electron main process. Security controls are implemented in the server and validated in tests:

- **Server binding**: HTTP server binds exclusively to `127.0.0.1` (localhost), never `0.0.0.0`.
- **Origin validation**: Sensitive endpoints (`/api/shutdown`, `/api/open-data`) validate `Origin`/`Referer` headers against `http://127.0.0.1:<port>`.
- **Content Security Policy**: All responses include restrictive CSP headers:
  - Static assets: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`
  - API responses: `default-src 'none'; frame-ancestors 'none'`
- **Path traversal protection**: `safeJoin` uses `fs.realpathSync` to canonicalize paths and prevent symlink escapes; validated in tests.
- **Input validation**: All API endpoints validate collection names, payload sizes (≤1MB), JSON structure, and required fields.
- **Integration honesty gate**: Integrations requiring configuration cannot be marked `connected` without valid config (returns 409).
- **Secret redaction**: Logs and error responses redact common token patterns (sk-, nvapi-, ghp_, Bearer, api_key, token, secret, password).
- **No arbitrary code execution**: Skills are data-only (reference/artifact/self-triggered); templates use safe token replacement, never `eval` or `Function`.
- **No background routines**: Routines run only on explicit user trigger; no scheduler exists.

## 5. Filesystem and process controls

- Store app-owned data in an application-specific user data directory, not the source tree or unrelated projects.
- Any file feature must operate on explicitly approved roots and reject traversal, unauthorized absolute paths, and symlink escapes.
- Use canonical paths and re-check after path resolution before any privileged operation.
- Avoid unrestricted recursive scanning. Respect exclusions and size limits.
- Do not use a renderer-provided path as trusted authority.
- If a shell/CLI integration is introduced, use a fixed executable and structured argument list, restrict working directories, enforce timeouts, cap output, and record an auditable result.
- Never run as administrator by default.

## 6. Skills, memory, and micro-apps

### Skills

- Skill files are instructions/data, not code with automatic privileges.
- Validate schema, required metadata, path, file size, and allowed asset references.
- Imported skills cannot add their own privileged tools or alter the permission system.
- Show the skill content or summary and required capabilities before use.
- Require explicit approval for external writes, destructive actions, credential access, or broader filesystem operations.
- Self-improvement must create a reviewable proposal or diff. Never silently modify active skills based on arbitrary feedback.

### Memory

- Keep user-visible controls for review, correction, export, archive, and deletion.
- Minimize sensitive information and avoid writing credentials, authentication artifacts, or secrets to memory.
- Distinguish temporary context from durable user-approved memory.
- Use pending notes/proposals for calibration; require approval before changing durable preferences or workflow rules.
- Do not send stored memory to a remote model unless the active feature requires it and the user has authorized that transfer.

### Micro-apps

- Initially load only bundled, trusted micro-apps from the application itself.
- Do not execute dynamically downloaded JavaScript or arbitrary packages as micro-apps.
- Give each micro-app a declared capability list; enforce capabilities in main-process services, not only in the UI.

## 7. External services, credentials, and privacy

- Integrations remain disconnected until explicitly configured.
- Request the narrowest practical OAuth/API permissions. Prefer read-only scopes during initial testing when possible.
- Store credentials only in an appropriate local secret store or carefully protected user-specific configuration; never commit real secrets or put them in the renderer bundle.
- Redact authorization headers, cookies, API keys, and sensitive request/response content from logs and reports.
- Clearly identify which data is sent to which provider and when a workflow will incur provider usage or charges.
- Do not silently switch to a different provider, paid service, or account.
- Provide disconnect/revocation instructions for configured integrations.

## 8. Routines and autonomy

- No recurring/background routine is enabled by default.
- Clearly show trigger, frequency, permissions, data sources, budgets, and expected effects before activation.
- Require confirmation before enabling a routine that sends messages, changes external data, deletes data, spends money, or makes other consequential changes.
- Provide pause/disable controls and persistent run history.
- Apply maximum runtime, retry, concurrency, output, and token/cost budgets where measurable.
- Passive routines should notify only when worthwhile and should not continuously contact a model without an explicit budget.
- Rate-limit failures must be recorded; do not retry indefinitely.

## 9. Logging and retention

- Log status, timestamps, operation identifiers, and safe error categories rather than raw secret-bearing payloads.
- Treat memory, email text, documents, and prompts as potentially sensitive.
- Make retention and deletion behavior understandable; avoid unlimited diagnostic logging by default.
- Errors presented to the user should be actionable but must not expose tokens, absolute sensitive paths unnecessarily, or full secret-bearing responses.

## 10. Threat handling and test plan

Before declaring the relevant milestone complete, the Maker should test or document why each test cannot yet run:

- IPC calls with invalid types, unexpected channels, or unauthorized sender context are rejected.
- Renderer cannot access Node.js, arbitrary filesystem paths, or unrestricted shell execution.
- Path traversal and symlink escape attempts are rejected.
- Oversized or malformed skill files are rejected safely.
- Skill content cannot grant extra capabilities without the application's separate authorization mechanism.
- Credentials do not appear in test output, logs, source, or reports.
- An unconfigured provider is shown as disconnected and causes no external request.
- A routine does not run before activation; budgets/retry limits and pause/disable controls work.
- Application data remains usable after a normal restart; backup/recovery behavior is documented.

## 11. Incident/recovery procedure

If an unexpected operation occurs:
1. Stop or disable the affected routine/integration using a known safe control.
2. Preserve redacted logs and the current project state; do not paste credentials into an agent prompt.
3. Revoke exposed credentials through the provider where necessary.
4. Identify the affected capability and narrow/remove it.
5. Add a regression test before re-enabling the feature.

## 12. Explicit non-goals for the first milestone

- No arbitrary remote code execution or downloaded executable micro-apps.
- No automatic credential discovery.
- No hidden persistence, stealth behavior, or self-installing background service.
- No unrestricted browser automation or shell access from skills.
- No automatic external writes or paid-provider fallback.
- No assumption that model-generated content is trusted or correct.
