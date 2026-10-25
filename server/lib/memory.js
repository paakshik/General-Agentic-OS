'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./util');

const AREAS = ['inbox', 'preferences', 'projects', 'reference', 'workflow'];
const REL_OK = /^([\w-]+)\/([\w-]+)\.md$/; // area/slug.md only — blocks traversal by construction
const INDEX_OK = /^00-INDEX\.md$/;

class Memory {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'memory');
    U.ensureDir(this.dir);
    this.seed();
  }

  seed() {
    const indexFile = path.join(this.dir, '00-INDEX.md');
    if (!fs.existsSync(indexFile)) {
      U.ensureDir(this.dir);
      fs.writeFileSync(indexFile, [
        '# Meridian Memory Index',
        '',
        'Areas: **inbox** (captures awaiting triage), **preferences**, **projects**, **reference**, **workflow**.',
        '',
        'Rules:',
        '- Nothing lands here automatically. Captures arrive via quick capture or the Memory note box.',
        '- Review is explicit: proposals created in the Memory module are applied only when you approve them.',
        '- Session context is temporary and is never promoted to permanent memory without a proposal you approve.',
        '',
        '_Regenerate this index by editing the files directly; the module reads the folder._'
      ].join('\n'));
    }
    const seeds = {
      'inbox/capture.md': '# Captures\n\n<!-- Append-only capture log. Triage items into the other areas. -->',
      'preferences/example-preference.md': '# Example preference (example)\n\n<!-- demo -->\n\nI prefer concise answers with the decision first. Delete this example and add your own.',
      'projects/example-project.md': '# Example project (example)\n\n<!-- demo -->\n\nMeridian OS build: milestones tracked in PLAN.md and STATUS.md at the project root.',
      'reference/example-reference.md': '# Example reference (example)\n\n<!-- demo -->\n\nUseful reference material goes here as plain Markdown.',
      'workflow/example-workflow.md': '# Example workflow (example)\n\n<!-- demo -->\n\nA recurring workflow worth memorising, e.g. how you like weekly reviews done.'
    };
    for (const [rel, content] of Object.entries(seeds)) {
      const f = path.join(this.dir, rel);
      if (!fs.existsSync(f)) {
        U.ensureDir(path.dirname(f));
        fs.writeFileSync(f, content);
      }
    }
  }

  list() {
    const out = { areas: {} };
    for (const area of AREAS) {
      const dir = path.join(this.dir, area);
      const files = [];
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
          const full = path.join(dir, f);
          const st = fs.statSync(full);
          const raw = fs.readFileSync(full, 'utf8');
          const titleMatch = raw.match(/^#\s+(.+)$/m);
          files.push({
            path: area + '/' + f,
            title: titleMatch ? titleMatch[1] : f,
            updated: st.mtime.toISOString(),
            size: st.size
          });
        }
      }
      out.areas[area] = files;
    }
    if (fs.existsSync(path.join(this.dir, '00-INDEX.md'))) {
      const st = fs.statSync(path.join(this.dir, '00-INDEX.md'));
      out.index = { path: '00-INDEX.md', title: 'Memory Index', updated: st.mtime.toISOString(), size: st.size };
    }
    return out;
  }

  check(rel) {
    if (INDEX_OK.test(rel)) return path.join(this.dir, '00-INDEX.md');
    if (!REL_OK.test(rel)) return null;
    const area = rel.split('/')[0];
    if (!AREAS.includes(area)) return null;
    return U.safeJoin(this.dir, rel);
  }

  read(rel) {
    const f = this.check(rel);
    if (!f || !fs.existsSync(f)) throw Object.assign(new Error('Memory file not found'), { status: 404 });
    return { path: rel, content: fs.readFileSync(f, 'utf8') };
  }

  write(rel, content) {
    const f = this.check(rel);
    if (!f) throw Object.assign(new Error('Invalid memory path (use area/slug.md)'), { status: 400 });
    if (typeof content !== 'string' || content.length > 200000) throw Object.assign(new Error('Invalid content'), { status: 400 });
    U.ensureDir(path.dirname(f));
    fs.writeFileSync(f, content);
    return { path: rel, updated: U.nowIso() };
  }

  note(text) {
    if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error('Note text required'), { status: 400 });
    const rel = 'inbox/capture.md';
    const f = this.check(rel);
    let cur = '';
    try { cur = fs.readFileSync(f, 'utf8'); } catch (e) { cur = '# Captures\n'; }
    cur = cur.trimEnd() + '\n\n- [' + U.nowIso() + '] ' + text.trim().replace(/\r?\n/g, ' ') + '\n';
    fs.writeFileSync(f, cur);
    return { path: rel };
  }

  archive(rel) {
    const f = this.check(rel);
    if (!f || !fs.existsSync(f)) throw Object.assign(new Error('Memory file not found'), { status: 404 });
    const arcDir = path.join(this.dir, '_archive');
    U.ensureDir(arcDir);
    const dest = path.join(arcDir, Date.now() + '-' + path.basename(f));
    fs.renameSync(f, dest);
    return { archived: rel };
  }
}

module.exports = { Memory, AREAS };
