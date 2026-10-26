'use strict';
// api.js — fetch helpers, toasts, escaping. Loaded first.
const API = {
  async req(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed (' + res.status + ')');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
  get: (u) => API.req('GET', u),
  post: (u, b) => API.req('POST', u, b || {}),
  put: (u, b) => API.req('PUT', u, b),
  del: (u) => API.req('DELETE', u)
};

function toast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'info');
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 4200);
}

// Escapes the five HTML-significant characters for text and quoted-attribute
// contexts. Every untrusted value placed via innerHTML or into an attribute
// must pass through here (fixes A1; required at every sink for A2).
// Entity strings are built by concatenation so the source never contains a
// raw HTML entity that text-processing tools could decode back into the
// character it names (which is how this map was silently corrupted before).
const ENTITY_AMP = '&' + 'amp;';
const HTML_ENTITIES = {
  '&': ENTITY_AMP,
  '<': '&' + 'lt;',
  '>': '&' + 'gt;',
  '"': '&' + 'quot;',
  "'": '&' + '#39;'
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
}

function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
}
function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }); } catch (e) { return ''; }
}
function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return Math.round(s) + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return fmtDate(iso);
}

// Node-side access for regression tests; browsers never define module.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { esc, fmtTime, fmtDate, timeAgo };
}
