'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Defensive redaction for anything that might reach logs or reports.
const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]'],
  [/\bnvapi-[A-Za-z0-9_-]{8,}/g, '[REDACTED]'],
  [/\bghp_[A-Za-z0-9]{20,}/g, '[REDACTED]'],
  [/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [REDACTED]'],
  [/((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)([^\s"',}]{4,})/gi, '$1[REDACTED]'],
];

function redactSecrets(s) {
  let out = String(s);
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

// Resolve rel inside base; return null on traversal attempts.
function safeJoin(base, rel) {
  const p = path.resolve(base, rel);
  const b = path.resolve(base);
  if (p === b || p.startsWith(b + path.sep)) return p;
  return null;
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

// Atomic-ish write: temp file + rename, so a crash never leaves truncated JSON.
function writeJsonAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function nowIso() {
  return new Date().toISOString();
}

function uid() {
  return crypto.randomUUID();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { redactSecrets, safeJoin, ensureDir, readJson, writeJsonAtomic, nowIso, uid, today };
