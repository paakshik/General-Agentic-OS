'use strict';
// Test optimistic concurrency control (rev field)
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server', 'server.js');
const PORT = 4794;

function startServer(dataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SERVER, '--port', String(PORT), '--data', dataDir], { stdio: 'ignore' });
    
    function waitHealth() {
      http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
        if (res.statusCode === 200) {
          let buf = '';
          res.on('data', (c) => { buf += c; });
          res.on('end', () => {
            try {
              const j = JSON.parse(buf);
              if (j.ok === true) return resolve(proc);
            } catch (e) { }
          });
        }
        setTimeout(waitHealth, 200);
      }).on('error', () => setTimeout(waitHealth, 200));
    }
    waitHealth();
  });
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      method,
      path,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    }, (res) => {
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-optimistic-'));
  console.log(`[test] Starting server with data dir ${dataDir}`);
  
  const proc = await startServer(dataDir);
  console.log('[test] Server started');
  
  // Create a task
  const created = await request('POST', '/api/store/tasks', { title: 'optimistic-test', done: false });
  console.log('[test] Created:', created.status);
  const task = JSON.parse(created.body);
  console.log('[test] Task rev:', task.rev);
  
  // Update with correct rev - should succeed
  const update1 = await request('PUT', `/api/store/tasks/${task.id}`, { done: true, _expectedRev: task.rev });
  console.log('[test] Update with correct rev:', update1.status);
  const task1 = JSON.parse(update1.body);
  console.log('[test] New rev:', task1.rev);
  
  // Update with stale rev - should fail with 409
  const update2 = await request('PUT', `/api/store/tasks/${task.id}`, { done: false, _expectedRev: task.rev });
  console.log('[test] Update with stale rev:', update2.status);
  
  // Update without rev - should succeed (no check)
  const update3 = await request('PUT', `/api/store/tasks/${task.id}`, { priority: 'high' });
  console.log('[test] Update without rev:', update3.status);
  
  proc.kill();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { }
  
  if (update1.status === 200 && update2.status === 409 && update3.status === 200) {
    console.log('[test] PASSED: Optimistic concurrency works');
    process.exit(0);
  } else {
    console.error('[test] FAILED');
    process.exit(1);
  }
}

main();
