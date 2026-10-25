'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const MODES = ['active', 'passive'];

function validateRoutine(m) {
  const errors = [];
  if (!m || typeof m !== 'object') {
    errors.push('Routine must be a JSON object.');
    return { ok: false, errors };
  }
  for (const f of ['id', 'name', 'description']) {
    if (typeof m[f] !== 'string' || !m[f].trim()) errors.push('Missing field: ' + f);
  }
  if (m.mode && !MODES.includes(m.mode)) errors.push('mode must be active or passive.');
  if (!Array.isArray(m.steps) || m.steps.length === 0) errors.push('steps must be a non-empty array.');
  return { ok: errors.length === 0, errors };
}

function listRoutines(routinesDir) {
  U.ensureDir(routinesDir);
  const out = [];
  for (const f of fs.readdirSync(routinesDir).filter((x) => x.endsWith('.json')).sort()) {
    const manifest = U.readJson(path.join(routinesDir, f), null);
    const v = validateRoutine(manifest);
    out.push({
      id: manifest && manifest.id ? manifest.id : f.replace(/\.json$/, ''),
      file: path.basename(f),
      manifest,
      valid: v.ok,
      errors: v.errors
    });
  }
  return out;
}

function findRoutine(routinesDir, id) {
  return listRoutines(routinesDir).find((r) => r.id === id) || null;
}

// ctx: { listStore(name), invokeSkill(entry, inputs, {confirm}), notify(msg), runsToday(id) }
// Returns { status, log, artifacts, notifications, startedAt, finishedAt }.
function run(entry, ctx, approved) {
  const m = entry.manifest;
  const log = [];
  const artifacts = [];
  const notifications = [];
  const counts = {};
  let status = 'success';
  const startedAt = U.nowIso();

  const limit = m.limits && m.limits.maxRunsPerDay;
  if (limit && ctx.runsToday(m.id) >= limit) {
    return {
      status: 'limit_reached', startedAt, finishedAt: U.nowIso(),
      log: [{ step: 'limit', status: 'blocked', detail: 'Daily limit of ' + limit + ' runs reached.' }],
      artifacts, notifications
    };
  }

  for (let i = 0; i < m.steps.length; i++) {
    const s = m.steps[i];
    const label = 'step ' + (i + 1) + ' (' + s.type + ')';
    try {
      if (s.type === 'query') {
        let items = ctx.listStore(s.collection);
        if (s.filter && s.filter.done === false) items = items.filter((x) => !x.done);
        if (s.filter && s.filter.done === true) items = items.filter((x) => !!x.done);
        counts[s.collection] = items.length;
        log.push({ step: label, status: 'ok', detail: s.collection + ': ' + items.length + ' item(s)' });
      } else if (s.type === 'skill') {
        if (s.gate && !approved) {
          status = 'awaiting_approval';
          log.push({ step: label, status: 'awaiting_approval', detail: 'Approval gate before skill "' + s.skill + '". Re-run with approval to continue.' });
          break;
        }
        const result = ctx.invokeSkill(s.skill, s.inputs || {}, { confirm: true });
        if (result.status === 'ok') {
          if (result.doc) artifacts.push(result.doc.id);
          log.push({ step: label, status: 'ok', detail: 'skill "' + s.skill + '" → ' + result.kind });
        } else {
          status = 'failed';
          log.push({ step: label, status: 'failed', detail: result.reason || result.status });
          break;
        }
      } else if (s.type === 'notify') {
        ctx.notify(s.message);
        notifications.push(s.message);
        log.push({ step: label, status: 'ok', detail: s.message });
      } else if (s.type === 'notify-if') {
        const when = s.when || {};
        const count = counts[when.collection] || 0;
        const hit = when.op === '>' ? count > when.value : when.op === '<' ? count < when.value : false;
        if (hit) {
          const msg = String(s.message).replace(/\{\{\s*count\s*\}\}/g, String(count));
          ctx.notify(msg);
          notifications.push(msg);
          log.push({ step: label, status: 'ok', detail: 'condition met (' + when.collection + '=' + count + ' ' + when.op + ' ' + when.value + '): ' + msg });
        } else {
          log.push({ step: label, status: 'skipped', detail: 'condition not met (' + when.collection + '=' + count + ')' });
        }
      } else {
        status = 'failed';
        log.push({ step: label, status: 'failed', detail: 'Unknown step type.' });
        break;
      }
    } catch (e) {
      status = 'failed';
      log.push({ step: label, status: 'failed', detail: U.redactSecrets(e.message) });
      break;
    }
  }

  return { status, log, artifacts, notifications, startedAt, finishedAt: U.nowIso() };
}

function seedRoutines(routinesDir) {
  U.ensureDir(routinesDir);
  const seeds = [
    {
      id: 'morning-brief', name: 'Morning Brief', mode: 'active', version: '1.0.0',
      description: 'Reads open tasks, then runs the Daily Brief skill to produce a dated brief document.',
      schedule: 'manual',
      scheduleNote: 'Runs only when you press Run. No scheduler is configured; nothing runs in the background.',
      limits: { maxRunsPerDay: 4 },
      steps: [
        { type: 'query', collection: 'tasks', filter: { done: false } },
        { type: 'skill', skill: 'daily-brief', inputs: { focus: 'Set by you' } },
        { type: 'notify', message: 'Morning Brief artifact created. See the Docs app.' }
      ]
    },
    {
      id: 'inbox-watch', name: 'Inbox Watch', mode: 'passive', version: '1.0.0',
      description: 'Checks the inbox size and notifies you only when it passes 5 unprocessed items.',
      schedule: 'manual',
      scheduleNote: 'Passive check you trigger manually. Automatic monitoring would need your explicit approval and is not configured.',
      limits: { maxRunsPerDay: 12 },
      steps: [
        { type: 'query', collection: 'inbox' },
        { type: 'notify-if', when: { collection: 'inbox', op: '>', value: 5 }, message: 'Inbox has {{count}} unprocessed items — consider a triage pass.' }
      ]
    }
  ];
  for (const r of seeds) {
    const f = path.join(routinesDir, r.id + '.json');
    if (!fs.existsSync(f)) U.writeJsonAtomic(f, r);
  }
}

module.exports = { validateRoutine, listRoutines, findRoutine, run, seedRoutines };
