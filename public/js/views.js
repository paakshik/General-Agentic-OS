'use strict';
// views.js — renderers for modules (overlay screens) and micro-apps.
// Each view: (bodyEl, ctx) where ctx = { S, refresh, openApp, openModule }.
// User content is escaped with esc(); views only read live server state.

const APPS = [
  { id: 'inbox', icon: '⇥', title: 'Quick Capture', desc: 'Capture and triage incoming items' },
  { id: 'notes', icon: '≡', title: 'Notes', desc: 'Searchable local knowledge' },
  { id: 'tasks', icon: '☑', title: 'Tasks', desc: 'Follow-ups and to-dos' },
  { id: 'docs', icon: '▣', title: 'Docs', desc: 'Documents and skill artifacts' },
  { id: 'launcher', icon: '⟳', title: 'Launcher', desc: 'Run routines and workflows' }
];

const VIEWS = {};

/* ---------------- module: apps gallery ---------------- */
VIEWS.apps = function (el, ctx) {
  el.innerHTML = '<div class="card-grid">' + APPS.map((a) =>
    '<div class="card"><h4><span class="app-ico" style="display:inline-flex;vertical-align:-6px;margin-right:7px">' + a.icon + '</span>' + esc(a.title) + '</h4><p>' + esc(a.desc) + '</p><div class="row"><button class="btn tiny accent" data-open-app="' + a.id + '">Open</button></div></div>'
  ).join('') + '</div>';
  el.querySelectorAll('[data-open-app]').forEach((b) =>
    b.addEventListener('click', () => ctx.openApp(b.dataset.openApp)));
};

/* ---------------- micro-app: inbox ---------------- */
VIEWS['app-inbox'] = function (el, ctx) {
  const items = ctx.S.inbox;
  el.innerHTML =
    '<div class="split" style="grid-template-columns:1fr">' +
    '<div><div class="section-title">Inbox (' + items.length + ')</div>' +
    '<div id="ib-list"></div></div></div>';
  const list = el.querySelector('#ib-list');
  if (!items.length) {
    list.innerHTML = '<div class="empty">Inbox is empty. Capture something from the dock below.</div>';
    return;
  }
  list.innerHTML = items.map((i) =>
    '<div class="app-row"><div class="app-meta"><b>' + esc(i.text) + '</b><span>' + esc(i.source || 'capture') + ' · ' + timeAgo(i.createdAt) + (i.demo ? ' · example' : '') + '</span></div>' +
    '<button class="btn tiny" data-to-task="' + i.id + '">→ Task</button>' +
    '<button class="btn tiny" data-to-note="' + i.id + '">→ Note</button>' +
    '<button class="icon-btn" data-del="' + i.id + '" title="Discard">✕</button></div>'
  ).join('');
  list.querySelectorAll('[data-to-task]').forEach((b) => b.addEventListener('click', async () => {
    const it = items.find((x) => x.id === b.dataset.toTask);
    try {
      await API.post('/api/store/tasks', { title: it.text, priority: 'normal' });
      await API.del('/api/store/inbox/' + it.id);
      toast('Converted to task', 'ok');
      await ctx.refresh(true);
      VIEWS['app-inbox'](el, ctx);
    } catch (e) { toast(e.message, 'error'); }
  }));
  list.querySelectorAll('[data-to-note]').forEach((b) => b.addEventListener('click', async () => {
    const it = items.find((x) => x.id === b.dataset.toNote);
    try {
      await API.post('/api/store/notes', { title: it.text.slice(0, 60), content: it.text });
      await API.del('/api/store/inbox/' + it.id);
      toast('Converted to note', 'ok');
      await ctx.refresh(true);
      VIEWS['app-inbox'](el, ctx);
    } catch (e) { toast(e.message, 'error'); }
  }));
  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await API.del('/api/store/inbox/' + b.dataset.del);
      await ctx.refresh(true);
      VIEWS['app-inbox'](el, ctx);
    } catch (e) { toast(e.message, 'error'); }
  }));
};

/* ---------------- micro-app: notes ---------------- */
VIEWS['app-notes'] = function (el, ctx) {
  el.innerHTML =
    '<div class="split"><div class="list-col"><input id="n-search" placeholder="Search notes…" style="margin-bottom:8px"><div id="n-list"></div>' +
    '<button class="btn tiny accent" id="n-new" style="margin-top:10px">＋ New note</button></div>' +
    '<div class="edit-col"><label>Title</label><input id="n-title" type="text"><label>Content</label><textarea id="n-content"></textarea>' +
    '<div style="margin-top:10px;display:flex;gap:8px"><button class="btn accent tiny" id="n-save">Save</button><span class="sub" id="n-status"></span></div></div></div>';
  let current = null;
  const listEl = el.querySelector('#n-list');
  function renderList(q) {
    const notes = (ctx.S.notes || []).filter((n) => !q ||
      (n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q));
    listEl.innerHTML = notes.length ? notes.map((n) =>
      '<div class="app-row" data-id="' + n.id + '"><div class="app-meta"><b>' + esc(n.title || 'Untitled') + '</b><span>' + timeAgo(n.updatedAt) + (n.demo ? ' · example' : '') + '</span></div></div>'
    ).join('') : '<div class="empty">No notes match.</div>';
    listEl.querySelectorAll('[data-id]').forEach((r) => r.addEventListener('click', () => load(r.dataset.id)));
  }
  function load(id) {
    current = (ctx.S.notes || []).find((n) => n.id === id) || null;
    el.querySelector('#n-title').value = current ? current.title : '';
    el.querySelector('#n-content').value = current ? current.content : '';
    el.querySelector('#n-status').textContent = current ? '' : 'New note — save to persist';
  }
  el.querySelector('#n-search').addEventListener('input', (e) => renderList(e.target.value.toLowerCase()));
  el.querySelector('#n-new').addEventListener('click', () => load(null));
  el.querySelector('#n-save').addEventListener('click', async () => {
    const title = el.querySelector('#n-title').value.trim();
    const content = el.querySelector('#n-content').value;
    if (!title) return toast('Title required', 'error');
    try {
      if (current) await API.put('/api/store/notes/' + current.id, { title, content });
      else await API.post('/api/store/notes', { title, content });
      toast('Note saved', 'ok');
      await ctx.refresh(true);
      renderList('');
      if (!current) { current = (ctx.S.notes || [])[0]; load(current && current.id); }
    } catch (e) { toast(e.message, 'error'); }
  });
  renderList('');
  const first = (ctx.S.notes || [])[0];
  if (first) load(first.id);
};

/* ---------------- micro-app: tasks ---------------- */
VIEWS['app-tasks'] = function (el, ctx) {
  el.innerHTML =
    '<div style="display:flex;gap:8px;margin-bottom:12px"><input id="t-new" placeholder="New task title…" style="flex:1"><button class="btn accent tiny" id="t-add">Add</button></div>' +
    '<div id="t-tabs" style="display:flex;gap:6px;margin-bottom:8px">' +
    '<button class="mini" data-tab="open">Open</button><button class="mini" data-tab="done">Done</button></div>' +
    '<div id="t-list"></div>';
  let tab = 'open';
  const listEl = el.querySelector('#t-list');
  function render() {
    const tasks = (ctx.S.tasks || []).filter((t) => (tab === 'open' ? !t.done : !!t.done));
    listEl.innerHTML = tasks.length ? tasks.map((t) =>
      '<div class="app-row"><input type="checkbox" data-toggle="' + t.id + '"' + (t.done ? ' checked' : '') + ' style="width:auto">' +
      '<div class="app-meta"><b style="' + (t.done ? 'text-decoration:line-through;color:var(--faint)' : '') + '">' + esc(t.title) + '</b>' +
      '<span>' + esc(t.priority || 'normal') + (t.demo ? ' · example' : '') + '</span></div>' +
      '<button class="icon-btn" data-del="' + t.id + '" title="Delete">✕</button></div>'
    ).join('') : '<div class="empty">No ' + tab + ' tasks.</div>';
    listEl.querySelectorAll('[data-toggle]').forEach((c) => c.addEventListener('change', async () => {
      try { await API.put('/api/store/tasks/' + c.dataset.toggle, { done: c.checked }); await ctx.refresh(true); render(); }
      catch (e) { toast(e.message, 'error'); }
    }));
    listEl.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      try { await API.del('/api/store/tasks/' + b.dataset.del); await ctx.refresh(true); render(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }
  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    el.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('accent', x === b));
    render();
  }));
  el.querySelector('#t-add').addEventListener('click', add);
  el.querySelector('#t-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  async function add() {
    const v = el.querySelector('#t-new').value.trim();
    if (!v) return;
    try {
      await API.post('/api/store/tasks', { title: v, done: false, priority: 'normal' });
      el.querySelector('#t-new').value = '';
      await ctx.refresh(true);
      render();
    } catch (e) { toast(e.message, 'error'); }
  }
  el.querySelector('[data-tab="open"]').classList.add('accent');
  render();
};

/* ---------------- micro-app: docs ---------------- */
VIEWS['app-docs'] = function (el, ctx) {
  el.innerHTML =
    '<div class="split"><div class="list-col"><div id="d-list"></div>' +
    '<button class="btn tiny accent" id="d-new" style="margin-top:10px">＋ New document</button></div>' +
    '<div class="edit-col"><label>Title</label><input id="d-title" type="text"><label>Content (Markdown)</label><textarea id="d-content"></textarea>' +
    '<div style="margin-top:10px;display:flex;gap:8px;align-items:center"><button class="btn accent tiny" id="d-save">Save</button><span class="sub" id="d-src"></span></div></div></div>';
  let current = null;
  function renderList() {
    const docs = ctx.S.docs || [];
    el.querySelector('#d-list').innerHTML = docs.length ? docs.map((d) =>
      '<div class="app-row" data-id="' + d.id + '"><div class="app-meta"><b>' + esc(d.title || 'Untitled') + '</b><span>' + esc(d.source || 'doc') + ' · ' + timeAgo(d.updatedAt) + (d.demo ? ' · example' : '') + '</span></div></div>'
    ).join('') : '<div class="empty">No documents yet.</div>';
    el.querySelector('#d-list').querySelectorAll('[data-id]').forEach((r) =>
      r.addEventListener('click', () => load(r.dataset.id)));
  }
  function load(id) {
    current = (ctx.S.docs || []).find((d) => d.id === id) || null;
    el.querySelector('#d-title').value = current ? current.title : '';
    el.querySelector('#d-content').value = current ? current.content : '';
    el.querySelector('#d-src').textContent = current ? (current.source || '') : 'New document';
  }
  el.querySelector('#d-new').addEventListener('click', () => load(null));
  el.querySelector('#d-save').addEventListener('click', async () => {
    const title = el.querySelector('#d-title').value.trim();
    const content = el.querySelector('#d-content').value;
    if (!title) return toast('Title required', 'error');
    try {
      if (current) await API.put('/api/store/docs/' + current.id, { title, content });
      else await API.post('/api/store/docs', { title, content, source: 'manual' });
      toast('Document saved', 'ok');
      await ctx.refresh(true);
      renderList();
      if (!current) { current = (ctx.S.docs || [])[0]; load(current && current.id); }
    } catch (e) { toast(e.message, 'error'); }
  });
  renderList();
  const first = (ctx.S.docs || [])[0];
  if (first) load(first.id);
};

/* ---------------- micro-app: launcher ---------------- */
VIEWS['app-launcher'] = function (el, ctx) {
  el.innerHTML =
    '<div class="card-grid" id="l-cards"></div>' +
    '<div class="section-title">Recent runs</div><div id="l-runs"></div>';
  el.querySelector('#l-cards').innerHTML = (ctx.S.routines || []).map((r) =>
    '<div class="card"><h4>' + esc(r.manifest.name) + ' <span class="type-chip">' + esc(r.manifest.mode) + '</span></h4>' +
    '<p>' + esc(r.manifest.description) + '</p>' +
    '<div class="row"><span class="sub">Last run: ' + timeAgo(r.lastRun && r.lastRun.startedAt) + '</span>' +
    '<button class="btn tiny accent" data-run="' + r.id + '">▶ Run</button>' +
    '<button class="btn tiny" data-gate="' + r.id + '">Run w/ approval</button></div></div>'
  ).join('') || '<div class="empty">No routines found.</div>';
  el.querySelector('#l-runs').innerHTML = renderRunsTable((ctx.S.runs || []).slice(0, 12));
  el.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => runRoutine(b.dataset.run, false)));
  el.querySelectorAll('[data-gate]').forEach((b) => b.addEventListener('click', () => runRoutine(b.dataset.gate, true)));
  async function runRoutine(id, approved) {
    try {
      const rec = await API.post('/api/routines/' + id + '/run', { approved });
      if (rec.status === 'awaiting_approval') toast('Routine paused at an approval gate (by design).', 'info');
      else if (rec.status === 'success') toast('Routine completed — ' + (rec.artifacts.length || 0) + ' artifact(s)', 'ok');
      else toast('Routine status: ' + rec.status, 'error');
      await ctx.refresh(true);
      VIEWS['app-launcher'](el, ctx);
    } catch (e) { toast(e.message, 'error'); }
  }
};

function renderRunsTable(runs) {
  if (!runs.length) return '<div class="empty">No runs recorded yet.</div>';
  return '<table class="runs"><tr><th>When</th><th>Routine</th><th>Status</th><th>Artifacts</th></tr>' +
    runs.map((r) =>
      '<tr><td>' + fmtTime(r.startedAt) + '</td><td>' + esc(r.routineName || r.routineId) + '</td>' +
      '<td class="status-' + esc(r.status) + '">' + esc(r.status) + '</td><td>' + (r.artifacts || []).length + '</td></tr>'
    ).join('') + '</table>';
}

/* ---------------- module: skills ---------------- */
VIEWS.skills = function (el, ctx) {
  el.innerHTML =
    '<div class="split" style="grid-template-columns:1fr">' +
    '<div><div class="section-title">Import skill (JSON manifest — validated on the server)</div>' +
    '<textarea id="sk-import" style="min-height:90px" placeholder=\'{"id":"my-skill","name":"My Skill","type":"artifact"}\'></textarea>' +
    '<button class="btn tiny accent" id="sk-import-btn" style="margin-top:8px">Import</button>' +
    '<div class="section-title">Installed skills</div><div class="card-grid" id="sk-grid"></div></div></div>';
  el.querySelector('#sk-import-btn').addEventListener('click', async () => {
    try {
      const manifest = JSON.parse(el.querySelector('#sk-import').value);
      await API.post('/api/skills/import', { manifest });
      toast('Skill imported and validated', 'ok');
      await ctx.refresh(true);
      VIEWS.skills(el, ctx);
    } catch (e) { toast('Import failed: ' + e.message + (e.data && e.data.errors ? ' (' + e.data.errors.join('; ') + ')' : ''), 'error'); }
  });
  const grid = el.querySelector('#sk-grid');
  grid.innerHTML = (ctx.S.skills || []).map((s) => {
    const m = s.manifest || {};
    const form = s.valid ? (m.inputs || []).map((i) =>
      '<label style="margin:6px 0 3px">' + esc(i.name) + (i.required ? ' *' : '') + '</label><input type="text" data-in="' + esc(i.name) + '">'
    ).join('') : '';
    return '<div class="card"><h4>' + esc(m.name || s.id) + ' <span class="type-chip">' + esc(m.type || '?') + '</span></h4>' +
      '<p>' + esc(m.description || '') + (s.valid ? '' : '<br><b style="color:var(--err)">Invalid manifest: ' + esc((s.errors || []).join(' ')) + '</b>') + '</p>' +
      (form ? '<div>' + form + '</div>' : '') +
      (m.type === 'self-triggered' && s.valid ? '<label style="display:flex;gap:6px;align-items:center;margin:8px 0 4px"><input type="checkbox" data-confirm style="width:auto"> Confirm execution</label>' : '') +
      (s.valid ? '<div class="row"><button class="btn tiny accent" data-invoke="' + esc(s.id) + '">Invoke</button>' +
        '<span class="sub">v' + esc(m.version || '?') + '</span></div>' : '') +
      '<div class="sub" data-out="' + esc(s.id) + '" style="margin-top:7px"></div></div>';
  }).join('') || '<div class="empty">No skills found in data/skills/.</div>';
  grid.querySelectorAll('[data-invoke]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.invoke;
    const card = b.closest('.card');
    const inputs = {};
    card.querySelectorAll('[data-in]').forEach((inp) => { if (inp.value.trim()) inputs[inp.dataset.in] = inp.value.trim(); });
    const confirmCb = card.querySelector('[data-confirm]');
    const entry = (ctx.S.skills || []).find((s) => s.id === id);
    const missing = (((entry || {}).manifest || {}).inputs || [])
      .filter((i) => i.required && !inputs[i.name]);
    if (missing.length) return toast('Required input missing: ' + missing.map((m) => m.name).join(', '), 'error');
    try {
      const r = await API.post('/api/skills/' + id + '/invoke', { inputs, confirm: !!(confirmCb && confirmCb.checked) });
      const out = card.querySelector('[data-out="' + id + '"]');
      if (r.status === 'needs_approval') out.textContent = 'Needs approval: ' + r.reason;
      else if (r.status === 'ok' && r.kind === 'document') { out.textContent = 'Artifact created: ' + r.doc.title; toast('Skill artifact created in Docs', 'ok'); }
      else if (r.status === 'ok') { out.textContent = r.content ? r.content.slice(0, 140) + '…' : 'Reference returned.'; }
      else out.textContent = 'Status: ' + r.status;
      await ctx.refresh(true);
    } catch (e) { toast(e.message, 'error'); }
  }));
};

/* ---------------- module: routines ---------------- */
VIEWS.routines = function (el, ctx) {
  el.innerHTML =
    '<div class="section-title">Routines (manual execution — nothing runs in the background)</div>' +
    '<div class="card-grid" id="r-cards"></div>' +
    '<div class="section-title">Run history (persistent)</div><div id="r-runs"></div>';
  el.querySelector('#r-cards').innerHTML = (ctx.S.routines || []).map((r) => {
    const m = r.manifest || {};
    const steps = (m.steps || []).map((s) => s.type + (s.skill ? ': ' + s.skill : '') + (s.gate ? ' [gate]' : '')).join(' → ');
    return '<div class="card"><h4>' + esc(m.name || r.id) + ' <span class="type-chip">' + esc(m.mode || '?') + '</span></h4>' +
      '<p>' + esc(m.description || '') + '</p>' +
      '<p class="sub">Schedule: ' + esc(m.scheduleNote || m.schedule || 'manual') + (m.limits ? ' · max ' + m.limits.maxRunsPerDay + ' runs/day' : '') + '</p>' +
      '<p class="sub">Steps: ' + esc(steps) + '</p>' +
      '<div class="row"><button class="btn tiny accent" data-run="' + esc(r.id) + '">▶ Run</button>' +
      '<button class="btn tiny" data-runa="' + esc(r.id) + '">Run w/ approval</button>' +
      '<span class="sub">Last: ' + timeAgo(r.lastRun && r.lastRun.startedAt) + '</span></div></div>';
  }).join('') || '<div class="empty">No routines found.</div>';
  el.querySelector('#r-runs').innerHTML = renderRunsTable(ctx.S.runs || []);
  el.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => doRun(b.dataset.run, false)));
  el.querySelectorAll('[data-runa]').forEach((b) => b.addEventListener('click', () => doRun(b.dataset.runa, true)));
  async function doRun(id, approved) {
    try {
      const rec = await API.post('/api/routines/' + id + '/run', { approved });
      showRunResult(el, rec);
      await ctx.refresh(true);
      VIEWS.routines(el, ctx);
    } catch (e) { toast(e.message, 'error'); }
  }
  const last = (ctx.S.runs || [])[0];
  if (last) showRunResult(el, last);
};

function showRunResult(el, rec) {
  const box = el.querySelector('#r-runs');
  if (!box || !rec || !rec.log) return;
  const detail = document.createElement('div');
  detail.className = 'logbox';
  detail.style.marginTop = '10px';
  detail.textContent = 'Last run "' + (rec.routineName || rec.routineId) + '" → ' + rec.status + '\n' +
    rec.log.map((l) => l.status.toUpperCase() + '  ' + l.step + ' — ' + l.detail).join('\n');
  box.insertBefore(detail, box.firstChild);
}

/* ---------------- module: memory ---------------- */
VIEWS.memory = function (el, ctx) {
  el.innerHTML =
    '<div class="split"><div class="list-col">' +
    '<div class="section-title">Capture a note</div>' +
    '<input id="m-note" placeholder="Quick note to memory inbox…"><button class="btn tiny accent" id="m-note-btn" style="margin-top:6px">Capture note</button>' +
    '<div id="m-files"></div></div>' +
    '<div class="edit-col"><div class="sub" id="m-path">Select a memory file</div>' +
    '<label>Content</label><textarea id="m-content"></textarea>' +
    '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
    '<button class="btn accent tiny" id="m-save">Save</button>' +
    '<button class="btn tiny" id="m-propose">Propose as new file</button>' +
    '<button class="btn tiny" id="m-archive">Archive</button>' +
    '<span class="sub" id="m-status"></span></div>' +
    '<div class="section-title">Proposals awaiting your approval</div><div id="m-proposals"></div></div></div>';
  let current = null;
  const filesEl = el.querySelector('#m-files');
  const M = ctx.S.memory || { areas: {} };
  filesEl.innerHTML = Object.keys(M.areas).map((area) => {
    const files = M.areas[area];
    return '<div class="section-title">' + esc(area) + '</div>' +
      (files.length ? files.map((f) =>
        '<div class="app-row" data-path="' + esc(f.path) + '"><div class="app-meta"><b>' + esc(f.title) + '</b><span>' + esc(f.path) + '</span></div></div>'
      ).join('') : '<div class="empty">empty</div>');
  }).join('') +
  (M.index ? '<div class="section-title">index</div><div class="app-row" data-path="00-INDEX.md"><div class="app-meta"><b>00-INDEX.md</b><span>master index</span></div></div>' : '');
  filesEl.querySelectorAll('[data-path]').forEach((r) => r.addEventListener('click', () => load(r.dataset.path)));

  async function load(path) {
    try {
      const r = await API.get('/api/memory/file?path=' + encodeURIComponent(path));
      current = path;
      el.querySelector('#m-path').textContent = path;
      el.querySelector('#m-content').value = r.content;
      el.querySelector('#m-status').textContent = '';
    } catch (e) { toast(e.message, 'error'); }
  }
  el.querySelector('#m-save').addEventListener('click', async () => {
    if (!current) return toast('Select a file first', 'error');
    try {
      await API.post('/api/memory/write', { path: current, content: el.querySelector('#m-content').value });
      toast('Memory file saved', 'ok');
      await ctx.refresh(true);
    } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelector('#m-note-btn').addEventListener('click', async () => {
    const v = el.querySelector('#m-note').value.trim();
    if (!v) return;
    try {
      await API.post('/api/memory/note', { text: v });
      el.querySelector('#m-note').value = '';
      toast('Captured to memory inbox', 'ok');
      await ctx.refresh(true);
    } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelector('#m-archive').addEventListener('click', async () => {
    if (!current || current === '00-INDEX.md') return toast('Select an area file to archive', 'error');
    try {
      await API.post('/api/memory/archive', { path: current });
      toast('Archived (file kept in data/memory/_archive)', 'ok');
      current = null;
      await ctx.refresh(true);
      VIEWS.memory(el, ctx);
    } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelector('#m-propose').addEventListener('click', async () => {
    const content = el.querySelector('#m-content').value;
    const path = (el.querySelector('#m-path').textContent || '').trim();
    if (!content.trim()) return toast('Write the proposed content first', 'error');
    const targetPath = (path && path.includes('/')) ? path : 'projects/proposed-' + Date.now() + '.md';
    try {
      await API.post('/api/memory/propose', { targetPath, content, action: current ? 'update' : 'create' });
      toast('Proposal filed — nothing changes until you approve', 'ok');
      await ctx.refresh(true);
      renderProposals();
    } catch (e) { toast(e.message, 'error'); }
  });
  function renderProposals() {
    const ps = ctx.S.proposals || [];
    el.querySelector('#m-proposals').innerHTML = ps.length ? ps.map((p) =>
      '<div class="app-row"><div class="app-meta"><b>' + esc(p.action) + ': ' + esc(p.targetPath) + '</b><span>' + timeAgo(p.createdAt) + '</span></div>' +
      '<button class="btn tiny" data-approve="' + p.id + '">Approve</button>' +
      '<button class="btn tiny" data-reject="' + p.id + '">Reject</button></div>'
    ).join('') : '<div class="empty">No pending proposals.</div>';
    el.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
      try { await API.post('/api/memory/proposals/' + b.dataset.approve + '/approve'); toast('Proposal applied', 'ok'); await ctx.refresh(true); VIEWS.memory(el, ctx); }
      catch (e) { toast(e.message, 'error'); }
    }));
    el.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
      try { await API.post('/api/memory/proposals/' + b.dataset.reject + '/reject'); toast('Proposal rejected', 'ok'); await ctx.refresh(true); VIEWS.memory(el, ctx); }
      catch (e) { toast(e.message, 'error'); }
    }));
  }
  renderProposals();
  const firstFile = M.areas && M.areas.inbox && M.areas.inbox[0];
  if (firstFile) load(firstFile.path);
};

/* ---------------- module: calendar ---------------- */
VIEWS.calendar = function (el, ctx) {
  const events = (ctx.S.events || []).slice().sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)));
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  const first = new Date(y, mo, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday-first
  const days = new Date(y, mo + 1, 0).getDate();
  const todayStr = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  let cells = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => '<div class="dow">' + d + '</div>').join('');
  for (let i = 0; i < startDow; i++) cells += '<div class="day"></div>';
  for (let d = 1; d <= days; d++) {
    const ds = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const has = events.some((e) => e.date === ds);
    cells += '<div class="day' + (ds === todayStr ? ' today' : '') + '">' + d + (has ? '<span class="ev"></span>' : '') + '</div>';
  }
  el.innerHTML =
    '<div class="section-title">' + now.toLocaleDateString([], { month: 'long', year: 'numeric' }) + ' — local calendar (no external service connected)</div>' +
    '<div class="cal-grid">' + cells + '</div>' +
    '<div class="section-title">Upcoming events</div>' +
    (events.length ? '<ul class="next-list">' + events.slice(0, 10).map((e) =>
      '<li><span>' + esc(e.title) + '</span><span class="when">' + esc(e.date) + ' ' + esc(e.time || '') + '</span></li>').join('') + '</ul>'
      : '<div class="empty">No events yet. Add one below — it stays on this machine.</div>') +
    '<div class="section-title">Add event</div>' +
    '<div style="display:flex;gap:8px;max-width:520px;flex-wrap:wrap">' +
    '<input id="c-title" type="text" placeholder="Event title" style="flex:2;min-width:160px">' +
    '<input id="c-date" type="date" style="flex:1;min-width:130px"><input id="c-time" type="time" style="flex:1;min-width:100px">' +
    '<button class="btn accent tiny" id="c-add">Add</button></div>';
  el.querySelector('#c-add').addEventListener('click', async () => {
    const title = el.querySelector('#c-title').value.trim();
    const date = el.querySelector('#c-date').value;
    if (!title || !date) return toast('Title and date are required', 'error');
    try {
      await API.post('/api/store/events', { title, date, time: el.querySelector('#c-time').value });
      toast('Event added (local)', 'ok');
      await ctx.refresh(true);
      VIEWS.calendar(el, ctx);
    } catch (e) { toast(e.message, 'error'); }
  });
};

/* ---------------- module: activity ---------------- */
VIEWS.activity = function (el, ctx) {
  const items = (ctx.S.activity || []).slice(0, 60);
  el.innerHTML = '<div class="section-title">Recent activity (from your real usage)</div>' +
    (items.length ? '<ul class="timeline">' + items.map((a) =>
      '<li><time>' + fmtTime(a.createdAt) + '</time><span><b style="color:var(--muted);font-weight:500">[' + esc(a.type || 'system') + ']</b> ' + esc(a.message) + '</span></li>'
    ).join('') + '</ul>' : '<div class="empty">No activity yet.</div>');
};

/* ---------------- module: assistant ---------------- */
VIEWS.assistant = function (el, ctx) {
  el.innerHTML =
    '<div class="sub" style="margin-bottom:8px">Local deterministic commands only — no model provider is configured, nothing leaves this machine. Type <b>help</b> for commands.</div>' +
    '<div class="transcript" id="a-out"><div class="assistant-line sys">Meridian assistant ready.</div></div>' +
    '<div style="display:flex;gap:8px"><input id="a-in" placeholder="e.g. summary — or capture buy milk — or run morning-brief" style="flex:1"><button class="btn accent tiny" id="a-go">Send</button></div>';
  const out = el.querySelector('#a-out');
  function line(text, cls) {
    const d = document.createElement('div');
    d.className = 'assistant-line ' + (cls || '');
    d.textContent = text;
    out.appendChild(d);
    out.scrollTop = out.scrollHeight;
  }
  async function send() {
    const v = el.querySelector('#a-in').value.trim();
    if (!v) return;
    line('» ' + v, 'sys');
    el.querySelector('#a-in').value = '';
    try {
      const r = await API.post('/api/assistant', { command: v });
      (r.lines || []).forEach((l) => line(l));
      await ctx.refresh(true);
    } catch (e) { line('Error: ' + e.message, 'sys'); }
  }
  el.querySelector('#a-go').addEventListener('click', send);
  el.querySelector('#a-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  el.querySelector('#a-in').focus();
};

/* ---------------- module: settings ---------------- */
VIEWS.settings = function (el, ctx) {
  const S = ctx.S;
  el.innerHTML =
    '<div class="section-title">General</div>' +
    '<p class="sub">Name: ' + esc(S.settings.name) + ' · v' + esc(S.settings.version) + ' · shell: browser tab at http://127.0.0.1:' + esc(S.settings.port) + '</p>' +
    '<p class="sub">All data is stored in D:\\General-Agentic-OS\\data (JSON stores, skills, routines, memory, logs). <button class="btn tiny" id="s-open-data">Open data folder</button></p>' +
    '<div class="section-title">Integrations — honest states only</div>' +
    (S.integrations || []).map((i) =>
      '<div class="app-row"><div class="app-meta"><b>' + esc(i.name) + '</b><span>' + esc(i.note || '') + '</span></div>' +
      '<span class="chip ' + (i.status === 'connected' ? 'ok' : i.status === 'local' ? 'local' : '') + '">' + esc(i.status.replace('_', ' ')) + '</span>' +
      (i.requiresConfig ? '<button class="btn tiny" data-cfg="' + esc(i.id) + '">Configure…</button>' : '') + '</div>'
    ).join('') +
    '<div class="section-title">Maintenance</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="btn tiny" id="s-clear-demo">Remove example data</button>' +
    '<button class="btn tiny danger" id="s-shutdown">Shut down server</button></div>' +
    '<p class="sub" style="margin-top:10px">Shutdown closes the local server. Relaunch from the desktop shortcut.</p>';

  el.querySelector('#s-open-data').addEventListener('click', async () => {
    try { await API.post('/api/open-data'); } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelectorAll('[data-cfg]').forEach((b) => b.addEventListener('click', () => {
    const i = (S.integrations || []).find((x) => x.id === b.dataset.cfg);
    toast('Required configuration: ' + ((i && i.configNeeded) || []).join('; ') + '. Meridian OS will not connect or fetch anything until you provide it. (Integration features arrive in later milestones.)', 'info');
  }));
  el.querySelector('#s-clear-demo').addEventListener('click', async () => {
    try {
      let n = 0;
      for (const coll of ['inbox', 'tasks', 'notes', 'docs']) {
        for (const it of (ctx.S[coll] || []).filter((x) => x.demo)) {
          await API.del('/api/store/' + coll + '/' + it.id);
          n++;
        }
      }
      toast(n + ' example item(s) removed', 'ok');
      await ctx.refresh(true);
      VIEWS.settings(el, ctx);
    } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelector('#s-shutdown').addEventListener('click', async () => {
    if (!window.confirm('Shut down the Meridian OS server? Relaunch with the desktop shortcut.')) return;
    try {
      await API.post('/api/shutdown', { confirm: true });
      toast('Server stopped. You can close this tab.', 'ok');
      document.getElementById('conn-dot').className = 'dot err';
    } catch (e) { toast(e.message, 'error'); }
  });
};

/* ---------------- module: search ---------------- */
VIEWS.search = function (el, ctx) {
  el.innerHTML =
    '<div style="display:flex;gap:8px;margin-bottom:12px"><input id="q-in" placeholder="Search tasks, notes, docs, inbox, memory…" style="flex:1"><button class="btn accent tiny" id="q-go">Search</button></div><div id="q-out"></div>';
  const out = el.querySelector('#q-out');
  async function go() {
    const q = el.querySelector('#q-in').value.trim();
    if (q.length < 2) return toast('Type at least 2 characters', 'error');
    try {
      const r = await API.get('/api/search?q=' + encodeURIComponent(q));
      let html = '';
      for (const [coll, items] of Object.entries(r.stores || {})) {
        html += '<div class="section-title">' + esc(coll) + '</div>' + items.map((it) =>
          '<div class="app-row"><div class="app-meta"><b>' + esc(it.title || it.text || '(item)') + '</b><span>' + esc(String(it.content || it.message || '').slice(0, 90)) + '</span></div></div>').join('');
      }
      if ((r.memory || []).length) {
        html += '<div class="section-title">memory</div>' + r.memory.map((m) =>
          '<div class="app-row"><div class="app-meta"><b>' + esc(m.path) + '</b><span>' + esc(m.line) + '</span></div></div>').join('');
      }
      out.innerHTML = html || '<div class="empty">No matches.</div>';
    } catch (e) { toast(e.message, 'error'); }
  }
  el.querySelector('#q-go').addEventListener('click', go);
  el.querySelector('#q-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
};
