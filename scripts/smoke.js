'use strict';
// smoke.js — starts server on random port, hits /api/health, /, /api/bootstrap, shuts down.
// Exits 0 on success, non-zero on failure.

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server', 'server.js');

function pickPort() {
  return 4800 + Math.floor(Math.random() * 1000);
}

function waitHealth(port, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const j = JSON.parse(buf);
              if (j.ok === true) return resolve();
            } catch (e) { /* ignore */ }
          }
          retry();
        });
      }).on('error', retry);
    }
    function retry() {
      if (Date.now() - start > timeoutMs) return reject(new Error('Health check timeout'));
      setTimeout(attempt, 200);
    }
    attempt();
  });
}

function request(method, port, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    };
    const req = http.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const port = pickPort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-smoke-'));
  console.log(`[smoke] Starting server on port ${port} with data dir ${dataDir}`);

  const proc = spawn(process.execPath, [SERVER, '--port', String(port), '--data', dataDir], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  proc.stdout.on('data', (d) => console.log('[server]', d.toString().trim()));
  proc.stderr.on('data', (d) => console.error('[server]', d.toString().trim()));

  let success = false;
  try {
    await waitHealth(port);
    console.log('[smoke] Health check passed');

    const health = await request('GET', port, '/api/health');
    console.log('[smoke] /api/health:', health.status, health.body.slice(0, 120));

    const root = await request('GET', port, '/');
    console.log('[smoke] /:', root.status, root.body.includes('Meridian OS') ? 'serves index.html' : 'unexpected');

    const bootstrap = await request('GET', port, '/api/bootstrap');
    console.log('[smoke] /api/bootstrap:', bootstrap.status, 'keys:', Object.keys(JSON.parse(bootstrap.body)).join(', '));

    const shutdown = await request('POST', port, '/api/shutdown?confirm=true');
    console.log('[smoke] /api/shutdown:', shutdown.status, shutdown.body);

    success = true;
  } catch (e) {
    console.error('[smoke] FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    proc.kill();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    if (success) {
      console.log('[smoke] All checks passed.');
      process.exit(0);
    }
  }
}

main();