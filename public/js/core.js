'use strict';
// core.js — lightweight particle intelligence core on <canvas id="core">.
// Adaptive particle count, pauses when the tab is hidden, static render under
// prefers-reduced-motion. Typical CPU use is a few percent; degrades itself if slow.
(function () {
  function start(canvas) {
    const c2d = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, CX = 0, CY = 0, R = 0, DPR = 1;

    function resize() {
      const r = canvas.parentElement.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      CX = W / 2; CY = H / 2;
      R = Math.min(W, H) * 0.30;
    }
    resize();
    window.addEventListener('resize', resize);

    const MAX = 220, MIN = 80;
    let N = reduceMotion ? 150 : 180;
    let pts = [];
    function build() {
      pts = [];
      const ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < N; i++) {
        const y = 1 - (i / (N - 1)) * 2;
        const rad = Math.sqrt(Math.max(0, 1 - y * y));
        const th = ga * i;
        pts.push({ x: Math.cos(th) * rad, y: y, z: Math.sin(th) * rad, accent: Math.random() < 0.14 });
      }
    }
    build();

    let rot = 0.7, running = true, last = performance.now(), acc = 0, frames = 0;

    function draw() {
      if (!W) { resize(); if (!W) return; }
      const c = c2d;
      c.setTransform(DPR, 0, 0, DPR, 0, 0);
      c.clearRect(0, 0, W, H);
      const tilt = rot * 0.6;
      const sy = Math.sin(tilt), cy = Math.cos(tilt);
      const wob = Math.sin(rot * 1.3) * 0.05;
      const proj = [];
      for (const p of pts) {
        const x = p.x * cy - p.z * sy;
        const z = p.x * sy + p.z * cy;
        const y = p.y + wob;
        const s = 1 / (1.9 - z * 0.9);
        proj.push({ sx: CX + x * R * s, sy: CY + y * R * s, s: s, z: z, a: p.accent });
      }
      c.lineWidth = 0.5;
      for (let i = 0; i < proj.length; i++) {
        const a = proj[i], b = proj[(i + 7) % proj.length];
        const dz = Math.abs(a.z - b.z);
        if (dz < 0.5) {
          const al = (0.05 + (1 - dz * 2) * 0.10) * Math.min(a.s, b.s);
          c.strokeStyle = 'rgba(255,122,26,' + al.toFixed(3) + ')';
          c.beginPath();
          c.moveTo(a.sx, a.sy);
          c.lineTo(b.sx, b.sy);
          c.stroke();
        }
      }
      for (const q of proj) {
        const depth = (q.z + 1) / 2;
        const alpha = 0.25 + depth * 0.6;
        c.fillStyle = q.a
          ? 'rgba(255,122,26,' + alpha.toFixed(3) + ')'
          : 'rgba(232,232,236,' + (alpha * 0.9).toFixed(3) + ')';
        const r = Math.min((1.1 + depth * 1.4) * q.s, 3);
        c.beginPath();
        c.arc(q.sx, q.sy, r, 0, 6.2832);
        c.fill();
      }
    }

    function frame(now) {
      if (running) {
        const dt = Math.min(now - last, 100);
        last = now;
        acc += dt; frames++;
        if (frames >= 50) {
          const avg = acc / frames;
          if (avg > 26 && N > MIN) { N = Math.max(MIN, N - 30); build(); }
          else if (avg < 15 && N < MAX) { N = Math.min(MAX, N + 20); build(); }
          acc = 0; frames = 0;
        }
        rot += dt * 0.00022;
        draw();
      } else {
        last = now;
      }
      requestAnimationFrame(frame);
    }

    document.addEventListener('visibilitychange', () => {
      running = !document.hidden && !reduceMotion;
      last = performance.now();
    });

    if (reduceMotion) {
      draw();
      window.addEventListener('resize', () => draw());
      return { stop() {} };
    }
    requestAnimationFrame(frame);
    return { stop() { running = false; } };
  }
  window.CoreViz = { start: start };
})();
