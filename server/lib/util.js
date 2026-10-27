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
// Uses fs.realpathSync to protect against symlink escapes.
// Handles non-existent targets by checking the parent directory.
function safeJoin(base, rel) {
  try {
    const target = path.resolve(base, rel);
    const realBase = fs.realpathSync.native(base);
    // For non-existent targets, check the parent directory's realpath
    let realTarget;
    try {
      realTarget = fs.realpathSync.native(target);
    } catch (e) {
      // Target doesn't exist; check parent directory
      const parent = path.dirname(target);
      const realParent = fs.realpathSync.native(parent);
      if (realParent === realBase || realParent.startsWith(realBase + path.sep)) return target;
      return null;
    }
    if (realTarget === realBase || realTarget.startsWith(realBase + path.sep)) return target;
    return null;
  } catch (e) {
    // Base doesn't exist or other FS error
    return null;
  }
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

// Retry rename with backoff (Windows: EPERM/EBUSY from AV/indexing/editor locks).
// Falls back to copy+delete. Keeps one .bak of previous version for recovery.
function renameWithRetry(tmp, target, maxAttempts = 5) {
  let attempt = 0;
  while (true) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (e) {
      attempt++;
      const isWindowsRetryable = process.platform === 'win32' &&
        (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES');
      if (attempt >= maxAttempts || !isWindowsRetryable) {
        // Fallback: copy then unlink
        try {
          fs.copyFileSync(tmp, target);
          fs.unlinkSync(tmp);
          return;
        } catch (e2) {
          throw Object.assign(new Error('Rename failed and fallback copy failed: ' + e2.message), { cause: e });
        }
      }
      // Exponential backoff 20-100ms
      const delay = 20 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 20);
      const start = Date.now();
      while (Date.now() - start < delay) { /* busy wait for short delays */ }
    }
  }
}

// Atomic JSON write: temp file + fsync + retrying rename.
// Keeps one .bak of the previous version for recovery on corruption.
function writeJsonAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  const bak = file + '.bak';

  // Write to temp file
  const content = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, content);

  // fsync the temp file to ensure it hits disk before rename
  // Use 'r+' mode (read+write) which works for fsync on Windows
  let fd;
  try {
    fd = fs.openSync(tmp, 'r+');
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  // If target exists, create/refresh .bak before rename
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, bak); } catch (e) { /* non-fatal */ }
  }

  // Rename with retry (Windows-friendly)
  renameWithRetry(tmp, file);
}

// Read JSON with fallback to .bak on corruption
function readJsonWithBackup(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    // Try .bak
    const bak = file + '.bak';
    if (fs.existsSync(bak)) {
      try {
        const data = JSON.parse(fs.readFileSync(bak, 'utf8'));
        // Log that we fell back to backup (caller should log this)
        return { data, usedBackup: true };
      } catch (e2) {
        // Both corrupted
      }
    }
    return fallback;
  }
}

// Clean up stray *.tmp files in a directory (call at startup)
function cleanupStrayTmp(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.tmp')) {
        try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }
}

function nowIso() {
  return new Date().toISOString();
}

function uid() {
  return crypto.randomUUID();
}

// Local-date helpers. The UI calendar uses the machine's local day, so server-side
// day boundaries (brief dates, daily run limits) must match it, not UTC. In timezones
// ahead of UTC, a UTC-based date lags the user's day until midnight UTC passes.
function fmtLocalDay(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function today() {
  return fmtLocalDay(new Date());
}

// Local calendar day of an ISO timestamp; '' when the timestamp is unparseable.
function localDay(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : fmtLocalDay(d);
}

// Atomic text write (memory files): temp file + fsync + retrying rename.
function writeFileAtomic(file, content) {
  ensureDir(path.dirname(file));
  const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  const str = String(content);
  fs.writeFileSync(tmp, str);

  // fsync
  let fd;
  try {
    fd = fs.openSync(tmp, 'r+');
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  renameWithRetry(tmp, file);
}

module.exports = {
  redactSecrets, safeJoin, ensureDir, readJson, readJsonWithBackup, writeJsonAtomic, writeFileAtomic,
  cleanupStrayTmp, nowIso, uid, today, localDay
};