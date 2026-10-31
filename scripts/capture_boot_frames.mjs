// Capture boot animation keyframes to verify the racing-depth swarm → morph.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9430;
const OUT = 'E:\\CacheSweep\\docs\\';

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=C:\\Windows\\Temp\\cs-boot-${Date.now()}`,
  '--window-size=1400,900',
  'http://127.0.0.1:5188/',
], { stdio: 'ignore' });

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('CDP unavailable');
}
const ws = new WebSocket(await endpoint());
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  const cb = pending.get(m.id); if (cb) { pending.delete(m.id); cb(m); }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
await send('Page.enable'); await send('Runtime.enable');

// Capture at several timestamps across the animation (~3.4s total).
const marks = [
  [250, 'boot-00-enter'],
  [800, 'boot-01-mid'],
  [1400, 'boot-02-dissolve'],
  [2400, 'boot-03-morph'],
  [3200, 'boot-04-mark'],
];

for (const [ms, name] of marks) {
  await sleep(ms - (marks[marks.indexOf([ms, name]) - 1]?.[0] || 0));
  // simpler: just sleep in absolute terms using elapsed tracking
}

// Re-run with absolute sleeps for clarity.
ws.close(); browser.kill();

// Simpler approach below
const browser2 = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=9431`,
  `--user-data-dir=C:\\Windows\\Temp\\cs-boot2-${Date.now()}`,
  '--window-size=1400,900',
  'http://127.0.0.1:5188/',
], { stdio: 'ignore' });
async function ep2() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:9431/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('CDP2 unavailable');
}
const ws2 = new WebSocket(await ep2());
let id2 = 0; const p2 = new Map();
ws2.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); const cb = p2.get(m.id); if (cb) { p2.delete(m.id); cb(m); } });
await new Promise((r) => ws2.addEventListener('open', r, { once: true }));
const send2 = (method, params = {}) => new Promise((res) => { const n = ++id2; p2.set(n, res); ws2.send(JSON.stringify({ id: n, method, params })); });
await send2('Page.enable');

const shot2 = (name) => send2('Page.captureScreenshot', { format: 'png' }).then(async (r) => {
  await writeFile(OUT + name + '.png', Buffer.from(r.result.data, 'base64'));
  console.log('saved', name);
});

// Timeline (need to be fast — animation is ~3.4s). Take 4 quick captures.
await sleep(500); await shot2('boot-01-flyin');
await sleep(500); await shot2('boot-02-dissolve');
await sleep(700); await shot2('boot-03-morph');
await sleep(700); await shot2('boot-04-mark');

console.log('--- JS errors ---');
console.log(errors.join('\n') || '(none)');
ws2.close(); browser2.kill();
console.log('done');