'use strict';
// app.js — orchestration: boot, state, panels, orbital navigation, overlay, dock.
(function () {
  let S = null;          // latest bootstrap state
  let coreViz = null;
  let currentView = null; // { kind: 'module'|'app', key }
  const ORBIT_NODES = [
    { key: 'apps', label: 'Apps', glyph: '▤' },
    { key: 'skills', label: 'Skills', glyph: '✦' },
    { key: 'routines', label: 'Routines', glyph: '⟳' },
    { key: 'memory', label: 'Memory', glyph: '⌸' },
    { key: 'calendar', label: 'Calendar', glyph: '▦' },
    { key: 'activity', label: 'Activity', glyph: '≡' },
    { key: 'assistant', label: 'Assistant', glyph: '⌘' },
    { key: 'settings', label: 'Settings', glyph: '⚙' }
  ];

  const $ = (id) => document.getElementById(id);

  async function refresh(rerenderOverlay) {
    S = await API.get('/api/bootstrap');
    $('conn-dot').className = 'dot ok';
    renderPanels();
    if (rerenderOverlay && currentView && !$('overlay').hidden) {
      const body = $('overlay-body');
      if (currentView.kind === 'app') VIEWS['app-' + currentView.key](body, ctx());
      else VIEWS[currentView.key](body, ctx());
    }
  }

  function ctx() {
    return {
      S,
      refresh,
      openApp,
      openModule
    };
  }

  /* ---------------- panels ---------------- */
  function renderPanels() {
    renderAppsPanel();
    renderCalendarPanel();
    renderConnectionsPanel();
    renderEmailPanel();
    renderSkillsPanel();
    renderRoutinesPanel();
  }

  function renderAppsPanel() {
    $('apps-list').innerHTML = APPS.map((a) =>
      '<div class="app-row"><div class="app-ico">' + a.icon + '</div>' +
      '<div class="app-meta"><b>' + esc(a.title) + '</b><span>' + esc(a.desc) + '</span></div>' +
      '<button class="mini" data-launch="' + esc(a.id) + '">Open</button></div>'
    ).join('');
    document.querySelectorAll('[data-launch]').forEach((b) =>
      b.addEventListener('click', () => openApp(b.dataset.launch)));
  }

  function renderCalendarPanel() {
    const events = (S.events || []).slice().sort((a, b) => String(a.date + (a.time || '')).localeCompare(String(b.date + (b.time || ''))));
    const now = new Date();
    const y = now.getFullYear(), mo = now.getMonth();
    const days = new Date(y, mo + 1, 0).getDate();
    const todayStr = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    let grid = '';
    for (let d = 1; d <= days; d++) {
      const ds = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const has = events.some((e) => e.date === ds);
      grid += '<i class="' + (has ? 'ev ' : '') + (ds === todayStr ? 'today' : '') + '"></i>';
    }
    $('dotgrid').innerHTML = grid;
    $('next-list').innerHTML = events.length
      ? events.slice(0, 4).map((e) =>
          '<li><span>' + esc(e.title) + '</span><span class="when">' + esc(e.date) + ' ' + esc(e.time || '') + '</span></li>').join('')
      : '<li class="muted">No events yet — open Calendar to add one.</li>';
  }

  function renderConnectionsPanel() {
    $('connections-list').innerHTML = (S.integrations || []).map((i) => {
      const cls = i.status === 'connected' ? 'ok' : i.status === 'local' ? 'local' : 'warn';
      return '<div class="conn-row"><span class="dot ' + (i.status === 'connected' ? 'ok' : '') + '" style="flex-shrink:0"></span>' +
        '<div class="app-meta"><b>' + esc(i.name) + '</b></div>' +
        '<span class="chip ' + cls + '">' + esc(i.status.replace('_', ' ')) + '</span></div>';
    }).join('');
  }

  function renderEmailPanel() {
    const email = (S.integrations || []).find((i) => i.kind === 'email');
    const state = $('email-state');
    if (!email || email.status !== 'connected') {
      state.textContent = email ? email.status.replace('_', ' ') : 'not configured';
      state.className = 'chip warn';
      $('email-body').innerHTML =
        '<div class="email-off"><div class="big">✉</div>' +
        '<p>No email provider is connected, so no inbox is shown. Nothing is fetched and nothing is faked.</p>' +
        '<button class="btn tiny accent" id="email-setup">Set up in Settings</button></div>';
      const b = $('email-setup');
      if (b) b.addEventListener('click', () => openModule('settings'));
    } else {
      state.textContent = 'connected';
      state.className = 'chip ok';
      $('email-body').innerHTML =
        '<div class="email-off"><p>Connected provider: ' + esc(email.name) +
        '.<br>Inbox synchronisation is not implemented yet (Milestone 4). This panel will stay honest about that.</p></div>';
    }
  }

  function renderSkillsPanel() {
    const q = ($('skill-filter').value || '').toLowerCase();
    const skills = (S.skills || []).filter((s) => s.valid).filter((s) => {
      if (!q) return true;
      const m = s.manifest || {};
      return (m.name || '').toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q) || (m.type || '').includes(q);
    });
    $('skills-cards').innerHTML = skills.slice(0, 4).map((s) => {
      const m = s.manifest || {};
      return '<div class="skill-card"><div class="app-meta"><b>' + esc(m.name || s.id) + '</b><span>' + esc(m.description || '') + '</span></div>' +
        '<span class="type-chip">' + esc(m.type || '?') + '</span>' +
        '<button class="mini" data-invoke-quick="' + esc(s.id) + '">Run</button></div>';
    }).join('') || '<div class="empty">No skills match.</div>';
    document.querySelectorAll('[data-invoke-quick]').forEach((b) =>
      b.addEventListener('click', async () => {
        const entry = (S.skills || []).find((s) => s.id === b.dataset.invokeQuick);
        const m = (entry && entry.manifest) || {};
        const needsForm = (m.inputs || []).some((i) => i.required) || m.type === 'self-triggered';
        if (needsForm) return openModule('skills');
        try {
          const r = await API.post('/api/skills/' + b.dataset.invokeQuick + '/invoke', { inputs: {} });
          if (r.status === 'ok' && r.kind === 'document') toast('Artifact created: ' + r.doc.title, 'ok');
          else toast('Skill returned reference content — open the deck to view', 'ok');
          await refresh(true);
        } catch (e) { toast(e.message, 'error'); }
      }));
  }

  function renderRoutinesPanel() {
    $('routines-list').innerHTML = (S.routines || []).map((r) =>
      '<div class="routine-row"><div class="app-meta"><b>' + esc(r.manifest.name) + '</b>' +
      '<span>' + esc(r.manifest.mode) + ' · last run ' + timeAgo(r.lastRun && r.lastRun.startedAt) + '</span></div>' +
      '<button class="mini" data-run-quick="' + esc(r.id) + '">▶ Run</button></div>'
    ).join('') || '<div class="empty">No routines configured.</div>';
    document.querySelectorAll('[data-run-quick]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          const rec = await API.post('/api/routines/' + b.dataset.runQuick + '/run', { approved: false });
          if (rec.status === 'awaiting_approval') toast('Paused at approval gate (by design).', 'info');
          else if (rec.status === 'success') toast('Routine complete — ' + (rec.artifacts.length || 0) + ' artifact(s)', 'ok');
          else toast('Routine status: ' + rec.status, 'error');
          await refresh(true);
        } catch (e) { toast(e.message, 'error'); }
      }));
  }

  /* ---------------- orbit ---------------- */
  function buildOrbit() {
    const orbit = $('orbit');
    orbit.innerHTML = '';
    const stage = orbit.parentElement.getBoundingClientRect();
    const size = Math.min(stage.width, stage.height);
    const r = size / 2 - 44;
    ORBIT_NODES.forEach((n, i) => {
      const a = (i / ORBIT_NODES.length) * Math.PI * 2 - Math.PI / 2;
      const x = stage.width / 2 + r * Math.cos(a) - 29;
      const y = stage.height / 2 + r * Math.sin(a) - 29;
      const b = document.createElement('button');
      b.className = 'orbit-node';
      b.style.left = x + 'px';
      b.style.top = y + 'px';
      b.dataset.module = n.key;
      b.innerHTML = '<span class="g">' + n.glyph + '</span><span class="t">' + n.label + '</span>';
      b.setAttribute('aria-label', 'Open ' + n.label + ' module');
      b.addEventListener('click', () => openModule(n.key));
      orbit.appendChild(b);
    });
  }

  /* ---------------- overlay ---------------- */
  const MODULE_TITLES = {
    apps: 'Micro Apps', skills: 'Skills Deck', routines: 'Routines', memory: 'Memory',
    calendar: 'Calendar', activity: 'Activity & History', assistant: 'Assistant', settings: 'Settings', search: 'Search'
  };

  function openModule(key) {
    currentView = { kind: 'module', key };
    $('overlay-title').textContent = MODULE_TITLES[key] || key;
    $('overlay-sub').textContent = 'Meridian OS · live local state';
    $('overlay').hidden = false;
    VIEWS[key]($('overlay-body'), ctx());
    document.querySelectorAll('.orbit-node').forEach((n) =>
      n.classList.toggle('active', n.dataset.module === key));
  }

  function openApp(id) {
    const app = APPS.find((a) => a.id === id);
    if (!app) return;
    currentView = { kind: 'app', key: id };
    $('overlay-title').textContent = app.title;
    $('overlay-sub').textContent = app.desc;
    $('overlay').hidden = false;
    const v = VIEWS['app-' + id];
    if (v) v($('overlay-body'), ctx());
    document.querySelectorAll('.orbit-node').forEach((n) => n.classList.remove('active'));
  }

  function closeOverlay() {
    $('overlay').hidden = true;
    currentView = null;
    document.querySelectorAll('.orbit-node').forEach((n) => n.classList.remove('active'));
  }

  /* ---------------- clock & capture ---------------- */
  function tickClock() {
    const now = new Date();
    let h = now.getHours();
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    const pad = (x) => String(x).padStart(2, '0');
    $('clock-time').textContent = pad(h) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    $('clock-ampm').textContent = ampm;
    $('clock-date').textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
    $('dock-clock').textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
  }

  async function quickCapture(text) {
    try {
      await API.post('/api/store/inbox', { text, source: 'quick capture' });
      toast('Captured to inbox', 'ok');
      await refresh(true);
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    try {
      await refresh(false);
      $('boot').hidden = true;
      $('os').hidden = false;
      buildOrbit();
      if (coreViz) coreViz.stop();
      coreViz = window.CoreViz.start($('core'));
      tickClock();
      setInterval(tickClock, 1000);
    } catch (e) {
      $('boot-msg').textContent = 'Could not reach the Meridian OS server (' + e.message + '). Start it with the desktop shortcut, then retry.';
      $('boot-retry').hidden = false;
    }
  }

  $('boot-retry').addEventListener('click', () => {
    $('boot-msg').textContent = 'Initialising Meridian OS…';
    $('boot-retry').hidden = true;
    boot();
  });
  $('overlay-close').addEventListener('click', closeOverlay);
  $('overlay').addEventListener('click', (e) => { if (e.target === $('overlay')) closeOverlay(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('overlay').hidden) closeOverlay(); });
  document.querySelectorAll('[data-open-module]').forEach((b) =>
    b.addEventListener('click', () => openModule(b.dataset.openModule)));
  $('capture-btn').addEventListener('click', () => $('capture-input').focus());
  $('capture-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const v = e.target.value.trim();
      if (v) { e.target.value = ''; quickCapture(v); }
    }
  });
  $('skill-filter').addEventListener('input', () => renderSkillsPanel());
  window.addEventListener('resize', () => { if (!$('os').hidden) buildOrbit(); });

  boot();
})();
