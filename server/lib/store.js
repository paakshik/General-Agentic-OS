'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const COLLECTIONS = ['inbox', 'tasks', 'notes', 'docs', 'events', 'activity', 'runs', 'proposals'];

const SEED_INTEGRATIONS = [
  {
    id: 'email-imap', name: 'Email (IMAP)', kind: 'email', status: 'not_configured',
    requiresConfig: true,
    configNeeded: ['IMAP host and port', 'account username', 'app-specific password (stored locally, never displayed)'],
    note: 'Until configured, no email is fetched or shown. The Email panel states this honestly.'
  },
  {
    id: 'calendar-local', name: 'Calendar (local)', kind: 'calendar', status: 'local',
    requiresConfig: false,
    note: 'Events you add are stored locally in data/stores/events.json. No external calendar is contacted.'
  },
  {
    id: 'calendar-google', name: 'Google Calendar', kind: 'calendar', status: 'not_configured',
    requiresConfig: true,
    configNeeded: ['Google Cloud project', 'OAuth consent screen', 'calendar.events read scope'],
    note: 'Requires your own Google Cloud credentials. Planned for a later milestone with your approval.'
  },
  {
    id: 'openrouter', name: 'OpenRouter (model provider)', kind: 'ai', status: 'not_configured',
    requiresConfig: true,
    configNeeded: ['API key stored locally, never displayed', 'explicit approval to send data off-device'],
    note: 'Milestone 4. The assistant stays local and deterministic until you approve a provider.'
  }
];

const DEMO = true; // example items are labelled and removable in Settings

function demoItems() {
  const now = U.nowIso();
  return {
    inbox: [
      { text: 'Example capture: review the Meridian OS plan this week', source: 'example', demo: DEMO, createdAt: now }
    ],
    tasks: [
      { title: 'Explore the command centre (example task)', done: false, priority: 'normal', demo: DEMO, createdAt: now },
      { title: 'Add a real calendar integration (example task)', done: false, priority: 'low', demo: DEMO, createdAt: now }
    ],
    notes: [
      {
        title: 'Welcome to Meridian OS (example note)',
        content: 'This note lives in data/stores/notes.json. Edit or delete it freely.\n\nEverything here is local: JSON files under data/, Markdown memory files, and skill/routine manifests you can open in any editor.',
        demo: DEMO, createdAt: now
      }
    ],
    docs: [
      {
        title: 'About Meridian OS (example doc)',
        content: '# About Meridian OS\n\nDocuments produced here (including skill artifacts) are stored in data/stores/docs.json and are plain text you can copy anywhere.',
        demo: DEMO, createdAt: now
      }
    ],
    events: [],
    activity: [
      { type: 'system', message: 'Meridian OS data store initialised', createdAt: now }
    ],
    runs: [],
    proposals: []
  };
}

class Store {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'stores');
    U.ensureDir(this.dir);
    // Clean up stray .tmp files from previous crashes
    U.cleanupStrayTmp(this.dir);
    this._cache = new Map(); // in-memory authoritative copy per collection
    this._queues = new Map(); // write queues per collection
    this.seed();
  }

  file(name) {
    return path.join(this.dir, name + '.json');
  }

  seed() {
    const seeds = demoItems();
    for (const name of COLLECTIONS) {
      if (!fs.existsSync(this.file(name))) {
        U.writeJsonAtomic(this.file(name), seeds[name] || []);
      }
      // prime cache
      this._cache.set(name, this._readFromDisk(name));
    }
    if (!fs.existsSync(this.file('integrations'))) {
      U.writeJsonAtomic(this.file('integrations'), SEED_INTEGRATIONS);
    }
    if (!fs.existsSync(this.file('settings'))) {
      U.writeJsonAtomic(this.file('settings'), {
        name: 'Meridian OS', version: '0.1.0', shell: 'browser',
        port: 4780, createdAt: U.nowIso()
      });
    }
  }

  _readFromDisk(name) {
    const file = this.file(name);
    const result = U.readJsonWithBackup(file, []);
    if (result && result.usedBackup) {
      // Log that we recovered from backup - caller (server.js) should log this
      this._lastRecovery = { file: name, path: file };
    }
    return Array.isArray(result) ? result : (result && result.data ? result.data : []);
  }

  // Get the authoritative in-memory copy, loading from disk if needed
  _getCache(name) {
    if (!this._cache.has(name)) {
      this._cache.set(name, this._readFromDisk(name));
    }
    return this._cache.get(name);
  }

  // Enqueue a write operation for a collection to serialize concurrent writes
  _enqueueWrite(name, fn) {
    if (!this._queues.has(name)) {
      this._queues.set(name, Promise.resolve());
    }
    const queue = this._queues.get(name);
    const next = queue.then(fn).catch((e) => { throw e; });
    this._queues.set(name, next);
    return next;
  }

  list(name) {
    if (!COLLECTIONS.includes(name)) throw Object.assign(new Error('Unknown collection: ' + name), { status: 400 });
    // Return a copy of the authoritative in-memory cache
    return [...this._getCache(name)];
  }

  save(name, arr) {
    if (!COLLECTIONS.includes(name)) throw Object.assign(new Error('Unknown collection: ' + name), { status: 400 });
    let out = arr;
    if (name === 'activity' && arr.length > 200) out = arr.slice(arr.length - 200);
    // Update cache first (authoritative), then persist
    this._cache.set(name, [...out]);
    return this._enqueueWrite(name, () => U.writeJsonAtomic(this.file(name), out));
  }

  async add(name, item) {
    if (!COLLECTIONS.includes(name)) throw Object.assign(new Error('Unknown collection: ' + name), { status: 400 });
    const arr = this._getCache(name);
    const full = Object.assign({ id: U.uid(), createdAt: U.nowIso(), updatedAt: U.nowIso(), rev: 1 }, item);
    arr.push(full);
    await this.save(name, arr);
    return full;
  }

  async update(name, id, patch) {
    if (!COLLECTIONS.includes(name)) throw Object.assign(new Error('Unknown collection: ' + name), { status: 400 });
    const arr = this._getCache(name);
    const i = arr.findIndex((x) => x.id === id);
    if (i === -1) throw Object.assign(new Error('Not found'), { status: 404 });

    // Optimistic concurrency: check rev if provided
    const expectedRev = patch && patch._expectedRev;
    if (expectedRev !== undefined && arr[i].rev !== expectedRev) {
      throw Object.assign(new Error('Conflict: item was modified by another request'), { status: 409 });
    }

    arr[i] = Object.assign({}, arr[i], patch, { updatedAt: U.nowIso(), rev: (arr[i].rev || 0) + 1 });
    await this.save(name, arr);
    return arr[i];
  }

  async remove(name, id) {
    if (!COLLECTIONS.includes(name)) throw Object.assign(new Error('Unknown collection: ' + name), { status: 400 });
    const arr = this._getCache(name);
    const next = arr.filter((x) => x.id !== id);
    await this.save(name, next);
    return arr.length - next.length;
  }

  getSettings() {
    return U.readJson(this.file('settings'), {});
  }

  putSettings(patch) {
    const cur = this.getSettings();
    const allowed = ['name', 'version', 'shell', 'port', 'accent', 'llm'];
    for (const k of Object.keys(patch || {})) {
      if (allowed.includes(k)) cur[k] = patch[k];
    }
    U.writeJsonAtomic(this.file('settings'), cur);
    return cur;
  }

  getIntegrations() {
    const v = U.readJson(this.file('integrations'), []);
    return Array.isArray(v) ? v : [];
  }

  putIntegration(id, patch) {
    const arr = this.getIntegrations();
    const i = arr.findIndex((x) => x.id === id);
    if (i === -1) throw Object.assign(new Error('Unknown integration'), { status: 404 });
    if (patch && typeof patch.status === 'string') {
      const it = arr[i];
      // Honesty gate: an integration that needs configuration can never be marked connected without it.
      if (it.requiresConfig && patch.status === 'connected' && (!it.config || Object.keys(it.config).length === 0)) {
        throw Object.assign(new Error('Configuration required before this integration can be connected'), { status: 409 });
      }
      arr[i].status = patch.status;
      if (patch.config && typeof patch.config === 'object') arr[i].config = patch.config;
      U.writeJsonAtomic(this.file('integrations'), arr);
      return arr[i];
    }
    throw Object.assign(new Error('Nothing to update'), { status: 400 });
  }

  // Wait for all pending writes to complete (for graceful shutdown)
  async flush() {
    for (const [, queue] of this._queues) {
      await queue;
    }
  }
}

module.exports = { Store, COLLECTIONS };