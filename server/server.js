'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const U = require('./lib/util');
const { Store } = require('./lib/store');
const skillsLib = require('./lib/skills');
const routinesLib = require('./lib/routines');
const { Memory, AREAS } = require('./lib/memory');
const { runAssistant } = require('./lib/provider');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
function argOf(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const PORT = parseInt(argOf('--port', '4780'), 10);
const DATA_DIR = path.resolve(argOf('--data', path.join(ROOT, 'data')));
const PUBLIC_DIR = path.join(ROOT, 'public');
const SKILLS_DIR = path.join(DATA_DIR, 'skills');
const ROUTINES_DIR = path.join(DATA_DIR, 'routines');

function log(level, msg) {
  const line = '[' + new Date().toISOString() + '] [' + level + '] ' + U.redactSecrets(msg);
  console.log(line);
  try {
    U.ensureDir(path.join(DATA_DIR, 'logs'));
    fs.appendFileSync(path.join(DATA_DIR, 'logs', 'server.log'), line + '\n');
  } catch (e) { /* logging must never crash the server */ }
}

// ---- boot stores ----
const store = new Store(DATA_DIR);
if (store._lastRecovery) {
  log('WARN', 'Recovered store file from backup: ' + store._lastRecovery.file + ' (' + store._lastRecovery.path + ')');
}
skillsLib.seedSkills(SKILLS_DIR);
routinesLib.seedRoutines(ROUTINES_DIR);
const memory = new Memory(DATA_DIR);

function notify(message, type) {
  store.add('activity', { type: type || 'system', message: U.redactSecrets(String(message)) }).catch((e) => log('ERROR', 'notify failed: ' + e.message));
}

function skillCtx() {
  return {
    date: U.today(),
    tasksOpen: store.list('tasks').filter((t) => !t.done),
    notesRecent: store.list('notes')
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
      .slice(0, 5),
    inboxItems: store.list('inbox'),
    createDoc: async (title, content, source) => {
      const doc = await store.add('docs', { title, content, source: source || 'skill' });
      return doc;
    }
  };
}

async function invokeSkillById(id, inputs, opts) {
  const entry = skillsLib.findSkill(SKILLS_DIR, id);
  if (!entry) throw Object.assign(new Error('Unknown skill: ' + id), { status: 404 });
  if (!entry.valid) throw Object.assign(new Error('Skill manifest is invalid: ' + entry.errors.join(' ')), { status: 400 });
  return skillsLib.invoke(entry, inputs, skillCtx(), opts || {});
}

async function runRoutineById(id, approved) {
  const entry = routinesLib.findRoutine(ROUTINES_DIR, id);
  if (!entry) throw Object.assign(new Error('Unknown routine: ' + id), { status: 404 });
  if (!entry.valid) throw Object.assign(new Error('Routine manifest is invalid: ' + entry.errors.join(' ')), { status: 400 });
  const ctx = {
    listStore: (name) => store.list(name),
    invokeSkill: async (sid, inputs, opts) => invokeSkillById(sid, inputs, opts),
    notify: (msg) => notify(msg, 'routine'),
    runsToday: (rid) =>
      store.list('runs').filter((r) => r.routineId === rid && String(r.startedAt || '').slice(0, 10) === U.today()).length
  };
  const record = await routinesLib.run(entry, ctx, !!approved);
  record.id = U.uid();
  record.routineId = entry.id;
  record.routineName = entry.manifest.name;
  await store.add('runs', record);
  return record;
}

function searchAll(q) {
  const needle = String(q || '').toLowerCase();
  if (needle.length < 2) return { stores: {}, memory: [] };
  const stores = {};
  for (const coll of ['inbox', 'tasks', 'notes', 'docs']) {
    const items = store
      .list(coll)
      .filter((it) =>
        [it.title, it.text, it.content, it.message]
          .filter((v) => typeof v === 'string')
          .some((v) => v.toLowerCase().includes(needle))
      )
      .slice(0, 8);
    if (items.length) stores[coll] = items;
  }
  const memoryHits = [];
  const listing = memory.list();
  for (const area of Object.keys(listing.areas)) {
    for (const f of listing.areas[area]) {
      try {
        const { content } = memory.read(f.path);
        const lines = content.split('\n').filter((l) => l.toLowerCase().includes(needle)).slice(0, 3);
        for (const line of lines) memoryHits.push({ path: f.path, line: line.trim().slice(0, 120) });
        if (memoryHits.length > 12) break;
      } catch (e) { /* skip unreadable file */ }
      if (memoryHits.length > 12) break;
    }
  }
  return { stores, memory: memoryHits };
}

function assistantCtx() {
  return {
    addInbox: async (text) => { await store.add('inbox', { text, source: 'assistant' }); },
    memoryNote: (text) => memory.note(text),
    runRoutine: async (id, approved) => {
      try { return await runRoutineById(id, approved); } catch (e) { return { error: e.message, status: 'failed' }; }
    },
    invokeSkill: async (id, inputs, opts) => {
      try { return await invokeSkillById(id, inputs, opts); } catch (e) { return { status: 'failed', reason: e.message }; }
    },
    search: searchAll,
    counts: () => ({
      tasks: store.list('tasks').filter((t) => !t.done).length,
      inbox: store.list('inbox').length,
      notes: store.list('notes').length,
      docs: store.list('docs').length,
      memoryFiles: AREAS.reduce((n, a) => n + memory.list().areas[a].length, 0)
    })
  };
}

function bootstrap() {
  const skills = skillsLib.listSkills(SKILLS_DIR);
  const runs = store.list('runs').slice().reverse().slice(0, 25);
  const routines = routinesLib.listRoutines(ROUTINES_DIR).map((r) => ({
    id: r.id,
    manifest: r.manifest,
    valid: r.valid,
    errors: r.errors,
    lastRun: runs.find((x) => x.routineId === r.id) || null
  }));
  const settings = store.getSettings();
  const llm = (settings && settings.llm) || { enabled: false };
  const bootstrapProvider = (llm.enabled && llm.baseUrl) ? 'litellm' : 'local-deterministic';
  return {
    settings,
    integrations: store.getIntegrations(),
    inbox: store.list('inbox'),
    tasks: store.list('tasks'),
    notes: store.list('notes'),
    docs: store.list('docs'),
    events: store.list('events'),
    activity: store.list('activity').slice().reverse(),
    skills,
    routines,
    runs,
    memory: memory.list(),
    proposals: store.list('proposals').filter((p) => p.status === 'pending'),
    bootstrapProvider
  };
}

// ---- static files ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = U.safeJoin(PUBLIC_DIR, rel);
  if (!file) {
    setCSP(res, false);
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }
  let target = file;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    setCSP(res, false);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  const ext = path.extname(target).toLowerCase();
  setCSP(res, false);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(target).pipe(res);
}

// ---- request handling ----
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// CSP headers for security
const CSP_STATIC = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'";
const CSP_API = "default-src 'none'; frame-ancestors 'none'";

function setCSP(res, isApi) {
  res.setHeader('Content-Security-Policy', isApi ? CSP_API : CSP_STATIC);
}

// Validate origin for sensitive endpoints (CSRF protection)
// Allows requests without Origin/Referer (same-origin browser requests)
// and validates Origin/Referer when present
function validateOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return true; // Same-origin requests may not send Origin/Referer
  try {
    const url = new URL(origin);
    return url.hostname === '127.0.0.1' && url.port === String(PORT);
  } catch (e) {
    return false;
  }
}

function send(res, code, data) {
  setCSP(res, true);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, pathname, query) {
  const method = req.method;
  const seg = pathname.split('/').filter(Boolean); // ['api', ...]

  // /api/health
  if (pathname === '/api/health' && method === 'GET') {
    return send(res, 200, { ok: true, name: 'Meridian OS', version: '0.1.0', uptimeSec: Math.round(process.uptime()) });
  }
  // /api/bootstrap
  if (pathname === '/api/bootstrap' && method === 'GET') return send(res, 200, bootstrap());

  // /api/store/:name(/:id)
  if (seg[1] === 'store' && seg[2]) {
    const name = seg[2];
    if (method === 'GET') return send(res, 200, store.list(name));
    if (method === 'POST') {
      const body = await readBody(req);
      const item = await store.add(name, body.item || body);
      return send(res, 201, item);
    }
    if (method === 'PUT' && seg[3]) {
      const body = await readBody(req);
      return send(res, 200, await store.update(name, seg[3], body.patch || body));
    }
    if (method === 'DELETE' && seg[3]) {
      const n = await store.remove(name, seg[3]);
      return send(res, 200, { removed: n });
    }
  }

  // /api/skills
  if (pathname === '/api/skills' && method === 'GET') return send(res, 200, skillsLib.listSkills(SKILLS_DIR));
  if (pathname === '/api/skills/import' && method === 'POST') {
    const body = await readBody(req);
    const manifest = body.manifest || body;
    const v = skillsLib.validateManifest(manifest);
    if (!v.ok) return send(res, 400, { error: 'Invalid skill manifest', errors: v.errors });
    if (skillsLib.findSkill(SKILLS_DIR, manifest.id)) {
      return send(res, 409, { error: 'A skill with id "' + manifest.id + '" already exists.' });
    }
    const file = U.safeJoin(SKILLS_DIR, manifest.id + '.json');
    if (!file) return send(res, 400, { error: 'Invalid skill id.' });
    U.writeJsonAtomic(file, manifest);
    notify('Imported skill: ' + manifest.name, 'skills');
    return send(res, 201, { id: manifest.id, valid: true });
  }
  if (seg[1] === 'skills' && seg[3] === 'invoke' && method === 'POST') {
    const body = await readBody(req);
    const result = await invokeSkillById(seg[2], body.inputs || {}, { confirm: !!body.confirm });
    notify('Invoked skill "' + seg[2] + '" → ' + result.status, 'skills');
    return send(res, 200, result);
  }

  // /api/routines
  if (pathname === '/api/routines' && method === 'GET') {
    const runs = store.list('runs').slice().reverse();
    return send(res, 200, routinesLib.listRoutines(ROUTINES_DIR).map((r) => ({
      id: r.id, manifest: r.manifest, valid: r.valid, errors: r.errors,
      lastRun: runs.find((x) => x.routineId === r.id) || null
    })));
  }
  if (seg[1] === 'routines' && seg[3] === 'run' && method === 'POST') {
    const body = await readBody(req);
    const record = await runRoutineById(seg[2], !!body.approved);
    return send(res, 200, record);
  }
  if (pathname === '/api/runs' && method === 'GET') {
    const runs = store.list('runs').slice().reverse();
    const rid = query.get('routineId');
    return send(res, 200, rid ? runs.filter((r) => r.routineId === rid).slice(0, 50) : runs.slice(0, 50));
  }

  // /api/memory
  if (pathname === '/api/memory' && method === 'GET') return send(res, 200, memory.list());
  if (pathname === '/api/memory/file' && method === 'GET') {
    const rel = query.get('path') || '';
    return send(res, 200, memory.read(rel));
  }
  if (pathname === '/api/memory/write' && method === 'POST') {
    const body = await readBody(req);
    return send(res, 200, memory.write(String(body.path || ''), body.content));
  }
  if (pathname === '/api/memory/note' && method === 'POST') {
    const body = await readBody(req);
    const r = memory.note(String(body.text || ''));
    notify('Memory note captured', 'memory');
    return send(res, 201, r);
  }
  if (pathname === '/api/memory/archive' && method === 'POST') {
    const body = await readBody(req);
    return send(res, 200, memory.archive(String(body.path || '')));
  }
  if (pathname === '/api/memory/propose' && method === 'POST') {
    const body = await readBody(req);
    if (!body.targetPath || typeof body.content !== 'string') {
      return send(res, 400, { error: 'targetPath and content are required.' });
    }
    const p = await store.add('proposals', {
      targetPath: String(body.targetPath), content: body.content,
      action: body.action === 'update' ? 'update' : 'create', status: 'pending'
    });
    return send(res, 201, p);
  }
  if (seg[1] === 'memory' && seg[2] === 'proposals' && seg[4] === 'approve' && method === 'POST') {
    const arr = store.list('proposals');
    const p = arr.find((x) => x.id === seg[3]);
    if (!p) return send(res, 404, { error: 'Proposal not found' });
    memory.write(p.targetPath, p.content);
    await store.update('proposals', p.id, { status: 'approved', decidedAt: U.nowIso() });
    notify('Memory proposal approved: ' + p.targetPath, 'memory');
    return send(res, 200, { approved: p.id, path: p.targetPath });
  }
  if (seg[1] === 'memory' && seg[2] === 'proposals' && seg[4] === 'reject' && method === 'POST') {
    const arr = store.list('proposals');
    const p = arr.find((x) => x.id === seg[3]);
    if (!p) return send(res, 404, { error: 'Proposal not found' });
    await store.update('proposals', p.id, { status: 'rejected', decidedAt: U.nowIso() });
    return send(res, 200, { rejected: p.id });
  }

  // /api/search
  if (pathname === '/api/search' && method === 'GET') {
    return send(res, 200, searchAll(query.get('q') || ''));
  }

  // /api/settings
  if (pathname === '/api/settings' && method === 'GET') return send(res, 200, store.getSettings());
  if (pathname === '/api/settings' && method === 'PUT') {
    const body = await readBody(req);
    return send(res, 200, store.putSettings(body));
  }

  // /api/integrations
  if (pathname === '/api/integrations' && method === 'GET') return send(res, 200, store.getIntegrations());
  if (seg[1] === 'integrations' && seg[2] && method === 'PUT') {
    const body = await readBody(req);
    const it = store.putIntegration(seg[2], body);
    notify('Integration "' + it.name + '" status set to ' + it.status, 'integrations');
    return send(res, 200, it);
  }

  // /api/assistant
  if (pathname === '/api/assistant' && method === 'POST') {
    const body = await readBody(req);
    const r = await runAssistant(body.command, assistantCtx());
    return send(res, 200, r);
  }

  // /api/open-data (Windows only, opens Explorer on the data folder)
  if (pathname === '/api/open-data' && method === 'POST') {
    if (!validateOrigin(req)) {
      return send(res, 403, { error: 'Not allowed from this origin' });
    }
    if (process.platform !== 'win32') return send(res, 501, { error: 'Only supported on Windows.' });
    const { spawn } = require('child_process');
    spawn('explorer', [DATA_DIR], { detached: true, stdio: 'ignore' }).unref();
    return send(res, 200, { opened: DATA_DIR });
  }

  // /api/shutdown
  if (pathname === '/api/shutdown' && method === 'POST') {
    if (!validateOrigin(req)) {
      return send(res, 403, { error: 'Shutdown not allowed from this origin' });
    }
    const body = await readBody(req).catch(() => ({}));
    if (!(body.confirm === true || query.get('confirm') === 'true')) {
      return send(res, 400, { error: 'Shutdown requires { confirm: true }.' });
    }
    send(res, 200, { stopping: true });
    log('INFO', 'Shutdown requested via API. Goodbye.');
    // Flush pending writes before exit
    store.flush().then(() => {
      log('INFO', 'Pending writes flushed.');
    }).catch((e) => {
      log('ERROR', 'Flush failed: ' + e.message);
    }).finally(() => {
      setTimeout(() => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 500).unref();
      }, 120);
    });
    return;
  }

  return send(res, 404, { error: 'Unknown API route: ' + method + ' ' + pathname });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const pathname = decodeURIComponent(u.pathname);
  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, u.searchParams);
    } else if (req.method === 'GET') {
      serveStatic(req, res, pathname);
    } else {
      send(res, 405, { error: 'Method not allowed' });
    }
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) log('ERROR', (e.stack || e.message));
    send(res, status, { error: U.redactSecrets(e.message || 'Server error') });
  }
});

process.on('uncaughtException', (e) => log('ERROR', 'uncaughtException: ' + (e.stack || e.message)));
process.on('unhandledRejection', (e) => log('ERROR', 'unhandledRejection: ' + U.redactSecrets(String(e))));

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log('ERROR', 'Port ' + PORT + ' is already in use. Another instance may be running. Exiting.');
    process.exit(1);
  }
  log('ERROR', 'Server error: ' + e.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  log('INFO', 'Meridian OS v0.1.0 listening on http://127.0.0.1:' + PORT + ' (data: ' + DATA_DIR + ')');
});
