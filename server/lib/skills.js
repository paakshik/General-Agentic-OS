'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const TYPES = ['reference', 'artifact', 'self-triggered'];

// Imported skill manifests are DATA. Nothing here ever evaluates skill content;
// templates are plain token replacement, so a hostile manifest cannot execute code.
function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    errors.push('Manifest must be a JSON object.');
    return { ok: false, errors };
  }
  for (const f of ['id', 'name', 'type', 'description', 'version']) {
    if (typeof m[f] !== 'string' || !m[f].trim()) errors.push('Missing field: ' + f);
  }
  if (m.type && !TYPES.includes(m.type)) errors.push('type must be one of: ' + TYPES.join(', '));
  if (m.id && !/^[a-z0-9][a-z0-9-]{1,40}$/.test(m.id)) errors.push('id must be kebab-case (letters, digits, dashes).');
  if (m.inputs !== undefined && !Array.isArray(m.inputs)) errors.push('inputs must be an array.');
  if (m.type === 'artifact' && !(m.output && typeof m.output.template === 'string' && m.output.template.includes('{{'))) {
    errors.push('Artifact skills need output.template containing {{tokens}}.');
  }
  if (m.type === 'reference' && !(m.output && typeof m.output.content === 'string')) {
    errors.push('Reference skills need output.content.');
  }
  return { ok: errors.length === 0, errors };
}

function render(template, vars) {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const parts = key.split('.');
    let v = vars;
    for (const p of parts) v = v == null ? undefined : v[p];
    return v === undefined || v === null ? '' : String(v);
  });
}

function listSkills(skillsDir) {
  U.ensureDir(skillsDir);
  const out = [];
  for (const f of fs.readdirSync(skillsDir).filter((x) => x.endsWith('.json')).sort()) {
    const file = path.join(skillsDir, f);
    const manifest = U.readJson(file, null);
    const v = validateManifest(manifest);
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

function findSkill(skillsDir, id) {
  return listSkills(skillsDir).find((s) => s.id === id) || null;
}

// ctx: { date, tasksOpen, notesRecent, inboxItems, createDoc(title, content, source) }
function invoke(entry, inputs, ctx, opts) {
  const confirm = !!(opts && opts.confirm);
  const input = inputs && typeof inputs === 'object' ? inputs : {};
  const m = entry.manifest;
  const vars = Object.assign(
    {
      date: ctx.date,
      tasks: {
        count: ctx.tasksOpen.length,
        list: ctx.tasksOpen.length ? ctx.tasksOpen.map((t) => '- ' + t.title).join('\n') : '_No open tasks._'
      },
      notes: {
        list: ctx.notesRecent.length
          ? ctx.notesRecent.map((n) => '- ' + n.title + ' (' + String(n.updatedAt || n.createdAt || '').slice(0, 10) + ')').join('\n')
          : '_No recent notes._'
      },
      inbox: {
        count: ctx.inboxItems.length,
        list: ctx.inboxItems.length ? ctx.inboxItems.map((i) => '- ' + i.text).join('\n') : '_Inbox empty._'
      }
    },
    input
  );

  if (m.type === 'reference') {
    return { status: 'ok', kind: 'reference', content: render(m.output.content, vars) };
  }
  if (m.type === 'self-triggered' && !confirm) {
    return {
      status: 'needs_approval',
      reason: 'Self-triggered skill "' + m.name + '" requires explicit confirmation before it runs. It suggests: ' + m.description
    };
  }
  // artifact, or self-triggered with confirm
  if (!(m.output && typeof m.output.template === 'string')) {
    return { status: 'failed', reason: 'Skill has no output template.' };
  }
  const content = render(m.output.template, vars);
  const doc = ctx.createDoc(m.name + ' — ' + ctx.date, content, 'skill:' + m.id);
  return { status: 'ok', kind: 'document', doc };
}

function seedSkills(skillsDir) {
  U.ensureDir(skillsDir);
  const seeds = [
    {
      id: 'daily-brief', name: 'Daily Brief', type: 'artifact', version: '1.0.0',
      description: 'Composes a dated brief from your open tasks and recent notes.',
      inputs: [{ name: 'focus', description: "Today's focus theme (optional)" }],
      compose: ['tasks.open', 'notes.recent'],
      instructions: 'Collect open tasks and the five most recent notes from local stores, then render the artifact template.',
      output: {
        kind: 'document',
        template: '# Daily Brief — {{date}}\n\n**Focus:** {{focus}}\n\n## Open tasks ({{tasks.count}})\n{{tasks.list}}\n\n## Recent notes\n{{notes.list}}\n\n---\n_Generated locally by Meridian OS from your own data. No external service was used._'
      },
      safety: { restrictions: 'Reads only local tasks and notes; writes one document; makes no network calls.' }
    },
    {
      id: 'writing-checklist', name: 'Writing Checklist', type: 'reference', version: '1.0.0',
      description: 'A short checklist for clear, human-sounding writing.',
      inputs: [],
      instructions: 'Return the reference content as-is.',
      output: {
        kind: 'reference',
        content: '# Writing Checklist\n\n1. Lead with the point.\n2. One idea per paragraph.\n3. Cut hedges and filler.\n4. Prefer concrete nouns and active verbs.\n5. Read it aloud; fix anything you stumble on.'
      },
      safety: { restrictions: 'None; static reference text.' }
    },
    {
      id: 'meeting-notes', name: 'Meeting Notes', type: 'artifact', version: '1.0.0',
      description: 'Turns raw meeting input into a structured notes document.',
      inputs: [
        { name: 'meeting', description: 'Meeting name', required: true },
        { name: 'attendees', description: 'Who attended' },
        { name: 'notes', description: 'Raw notes or decisions' }
      ],
      instructions: 'Render the structured template with the provided inputs.',
      output: {
        kind: 'document',
        template: '# {{meeting}} — Meeting Notes ({{date}})\n\n**Attendees:** {{attendees}}\n\n## Notes / decisions\n{{notes}}\n\n## Follow-ups\n- [ ] (add follow-ups as tasks)\n\n_Captured locally via the Meeting Notes skill._'
      },
      safety: { restrictions: 'Processes only the inputs you type; writes one document; no network calls.' }
    },
    {
      id: 'inbox-triage', name: 'Inbox Triage', type: 'self-triggered', version: '1.0.0',
      description: 'When the inbox grows past a handful of items, drafts a triage sheet grouping them for processing.',
      trigger: { when: 'inbox.count', op: '>', value: 5 },
      inputs: [],
      instructions: 'List all inbox items grouped into: act now, schedule, reference, discard.',
      output: {
        kind: 'document',
        template: '# Inbox Triage — {{date}}\n\nInbox items ({{inbox.count}}):\n{{inbox.list}}\n\n## Suggested grouping\n- Act now: (pick the two most urgent above)\n- Schedule: (items with a date)\n- Reference: (the rest worth keeping)\n- Discard: (noise)\n\n_Review this sheet, then process items in the Quick Capture app._'
      },
      safety: { restrictions: 'Reads the inbox only; writes one document; runs only on explicit confirmation.' }
    }
  ];
  for (const s of seeds) {
    const f = path.join(skillsDir, s.id + '.json');
    if (!fs.existsSync(f)) U.writeJsonAtomic(f, s);
  }
}

module.exports = { validateManifest, render, listSkills, findSkill, invoke, seedSkills, TYPES };
