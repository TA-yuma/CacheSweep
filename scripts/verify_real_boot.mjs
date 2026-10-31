// Verify the real-icon boot animation: slow fly-in, depth, dissolve, logo reveal.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9440;
const OUT = 'E:\\CacheSweep\\docs\\';

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=C:\\Windows\\Temp\\cs-real-${Date.now()}`,
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
    await sleep(250);
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

async function shoot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(OUT + name + '.png', Buffer.from(shot.result.data, 'base64'));
  console.log('saved', name);
}

// Animation timeline: arrive 2.6s, morph 3.6s, reveal 4.1s, total 5.0s.
await sleep(1200); await shoot('real-01-flyin');
await sleep(1200); await shoot('real-02-arrive');
await sleep(1100); await shoot('real-03-dissolve');
await sleep(1200); await shoot('real-04-logo');

console.log('--- JS errors ---');
console.log(errors.join('\n') || '(none)');

ws.close(); browser.kill();
console.log('done');