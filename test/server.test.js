'use strict';
// Meridian OS server test suite (node:test, zero dependencies).
// Covers: health/static, CRUD persistence across restart, path traversal,
// skill validation/invocation, self-triggered approval, routine runs/history,
// integration honesty gate, memory note/proposals, assistant, redaction, shutdown.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server', 'server.js');
const PORT = 4791;
const BASE = 'http://127.0.0.1:' + PORT;
let proc = null;
let dataDir;

function startServer() {
  proc = spawn(process.execPath, [SERVER, '--port', String(PORT), '--data', dataDir], { stdio: 'ignore' });
  return waitHealth();
}
function stopServer() {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    proc.once('exit', resolve);
    proc.kill();
  });
}
async function waitHealth() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not become healthy on ' + BASE);
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-test-'));
  await startServer();
});
after(async () => {
  await stopServer();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
});

test('health endpoint and static index', async () => {
  const r = await fetch(BASE + '/api/health');
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  assert.equal(j.name, 'Meridian OS');
  const page = await (await fetch(BASE + '/')).text();
  assert.ok(page.includes('Meridian OS'), 'index.html served');
});

test('CRUD works and persists across a full server restart', async () => {
  const created = await (await fetch(BASE + '/api/store/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'persist-me-12345', done: false })
  })).json();
  assert.ok(created.id, 'created with id');

  await stopServer();
  await startServer();

  const tasks = await (await fetch(BASE + '/api/store/tasks')).json();
  assert.ok(tasks.some((t) => t.title === 'persist-me-12345'), 'task survived restart');
  const upd = await (await fetch(BASE + '/api/store/tasks/' + created.id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done: true })
  })).json();
  assert.equal(upd.done, true);
  const del = await (await fetch(BASE + '/api/store/tasks/' + created.id, { method: 'DELETE' })).json();
  assert.equal(del.removed, 1);
});

test('unknown collections are rejected', async () => {
  const r = await fetch(BASE + '/api/store/not-a-collection');
  assert.equal(r.status, 400);
});

test('path traversal is blocked on static files and memory reads', async () => {
  const a = await fetch(BASE + '/..%2f..%2fserver%2fserver.js');
  assert.ok([403, 404].includes(a.status), 'static traversal blocked, got ' + a.status);
  const b = await fetch(BASE + '/api/memory/file?path=..%2f..%2fpackage.json');
  assert.ok([400, 404].includes(b.status), 'memory traversal blocked, got ' + b.status);
  const c = await fetch(BASE + '/api/memory/file?path=nope%2fbad.md');
  assert.ok([400, 404].includes(c.status), 'invalid area rejected, got ' + c.status);
});

test('seeded skills are valid; artifact skill creates a document', async () => {
  const skills = await (await fetch(BASE + '/api/skills')).json();
  assert.ok(skills.length >= 4, 'seed skills present');
  for (const s of skills) assert.equal(s.valid, true, 'skill ' + s.id + ' should validate: ' + (s.errors || []).join(';'));
  const inv = await (await fetch(BASE + '/api/skills/daily-brief/invoke', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: { focus: 'testing' } })
  })).json();
  assert.equal(inv.status, 'ok');
  assert.equal(inv.kind, 'document');
  assert.ok(inv.doc.title.startsWith('Daily Brief'), 'artifact titled');
  const docs = await (await fetch(BASE + '/api/store/docs')).json();
  const doc = docs.find((d) => d.id === inv.doc.id);
  assert.ok(doc, 'document persisted');
  assert.ok(doc.content.includes('Focus:** testing'), 'template rendered inputs');
  assert.ok(doc.content.includes('Generated locally'), 'template rendered');
});

test('self-triggered skill refuses to run without explicit confirmation', async () => {
  const r1 = await (await fetch(BASE + '/api/skills/inbox-triage/invoke', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs: {} })
  })).json();
  assert.equal(r1.status, 'needs_approval');
  const r2 = await (await fetch(BASE + '/api/skills/inbox-triage/invoke', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: {}, confirm: true })
  })).json();
  assert.equal(r2.status, 'ok');
});

test('skill import validates manifests and rejects bad ones', async () => {
  const bad = await fetch(BASE + '/api/skills/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest: { id: 'bad-skill', name: 'Bad', type: 'artifact' } })
  });
  assert.equal(bad.status, 400, 'missing template rejected');
  const good = await fetch(BASE + '/api/skills/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      manifest: {
        id: 'test-imported', name: 'Test Imported', type: 'reference', version: '1.0.0',
        description: 'imported by test', inputs: [],
        output: { kind: 'reference', content: 'imported reference body' }
      }
    })
  });
  assert.equal(good.status, 201);
  const dup = await fetch(BASE + '/api/skills/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      manifest: {
        id: 'test-imported', name: 'Test Imported', type: 'reference', version: '1.0.0',
        description: 'dup', inputs: [], output: { kind: 'reference', content: 'x' }
      }
    })
  });
  assert.equal(dup.status, 409, 'duplicate id rejected');
});

test('routine runs, records history, and respects unknown ids', async () => {
  const rec = await (await fetch(BASE + '/api/routines/morning-brief/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
  })).json();
  assert.equal(rec.status, 'success', 'morning-brief should succeed: ' + JSON.stringify(rec.log || rec));
  assert.ok(rec.artifacts.length >= 1, 'produced an artifact');
  const runs = await (await fetch(BASE + '/api/runs?routineId=morning-brief')).json();
  assert.ok(runs.some((r) => r.id === rec.id), 'history persisted');
  const nf = await fetch(BASE + '/api/routines/does-not-exist/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
  });
  assert.equal(nf.status, 404);
});

test('routine approval gate blocks without approval and passes with it', async () => {
  // seed a gated routine file directly into the test data dir
  const gated = {
    id: 'gated-test', name: 'Gated Test', mode: 'active', version: '1.0.0',
    description: 'has a gate', schedule: 'manual',
    steps: [
      { type: 'query', collection: 'inbox' },
      { type: 'skill', skill: 'writing-checklist', gate: true },
      { type: 'notify', message: 'should not appear without approval' }
    ]
  };
  fs.writeFileSync(path.join(dataDir, 'routines', 'gated-test.json'), JSON.stringify(gated));
  const blocked = await (await fetch(BASE + '/api/routines/gated-test/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved: false })
  })).json();
  assert.equal(blocked.status, 'awaiting_approval');
  assert.ok(blocked.log.some((l) => l.status === 'awaiting_approval'));
  const allowed = await (await fetch(BASE + '/api/routines/gated-test/run', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved: true })
  })).json();
  assert.equal(allowed.status, 'success');
  assert.ok(allowed.notifications.length >= 1, 'notify step ran after approval');
});

test('integrations cannot be marked connected without configuration', async () => {
  const r = await fetch(BASE + '/api/integrations/email-imap', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'connected' })
  });
  assert.equal(r.status, 409, 'honesty gate refused');
  const local = await fetch(BASE + '/api/integrations/calendar-local', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'local' })
  });
  assert.equal(local.status, 200, 'local calendar state is allowed');
});

test('memory note capture, file edit, and proposal approval', async () => {
  await fetch(BASE + '/api/memory/note', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'test capture alpha' })
  });
  const listing = await (await fetch(BASE + '/api/memory')).json();
  assert.ok(listing.areas.inbox.some((f) => f.path === 'inbox/capture.md'), 'capture file listed');
  const read = await (await fetch(BASE + '/api/memory/file?path=' + encodeURIComponent('inbox/capture.md'))).json();
  assert.ok(read.content.includes('test capture alpha'), 'note appended');

  const prop = await (await fetch(BASE + '/api/memory/propose', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetPath: 'projects/proposal-test.md', content: '# Proposed\n\napproved content', action: 'create' })
  })).json();
  assert.equal(prop.status, 'pending');
  const before = await (await fetch(BASE + '/api/memory/file?path=' + encodeURIComponent('projects/proposal-test.md')));
  assert.ok([404].includes(before.status), 'not written before approval');
  const ok = await (await fetch(BASE + '/api/memory/proposals/' + prop.id + '/approve', { method: 'POST' })).json();
  assert.equal(ok.approved, prop.id);
  const after = await (await fetch(BASE + '/api/memory/file?path=' + encodeURIComponent('projects/proposal-test.md'))).json();
  assert.ok(after.content.includes('approved content'), 'applied after approval');
});

test('search finds store items and memory lines', async () => {
  const r = await (await fetch(BASE + '/api/search?q=persist-me')).json();
  assert.ok(r.stores.tasks || r.stores.notes || r.stores.docs, 'searched stores');
  const m = await (await fetch(BASE + '/api/search?q=test capture alpha')).json();
  assert.ok((m.memory || []).length >= 1, 'searched memory');
});

test('assistant is local, deterministic, and honest', async () => {
  const help = await (await fetch(BASE + '/api/assistant', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'help' })
  })).json();
  assert.equal(help.provider, 'local-deterministic');
  assert.ok(help.lines.join(' ').includes('capture'), 'help lists commands');
  const sum = await (await fetch(BASE + '/api/assistant', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'summary' })
  })).json();
  assert.ok(sum.lines.join(' ').includes('open tasks'), 'summary works');
});

test('secret redaction scrubs obvious token patterns', async () => {
  const { redactSecrets } = require(path.join(ROOT, 'server', 'lib', 'util.js'));
  const secret = 'sk-abcdef1234567890qwerty';
  const out = redactSecrets('key sk-abcdef1234567890qwerty and nvapi-zyxw9876543210abcdef');
  assert.ok(!out.includes(secret), 'sk- token removed');
  assert.ok(out.includes('[REDACTED]'), 'replaced with [REDACTED]');
});

test('graceful shutdown works and health stops responding', async () => {
  const r = await fetch(BASE + '/api/shutdown?confirm=true', { method: 'POST' });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 600));
  let down = true;
  try { await fetch(BASE + '/api/health'); down = false; } catch (e) { down = true; }
  assert.ok(down, 'server stopped responding');
  await stopServer();
  await startServer();
});
