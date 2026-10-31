// Captures the installed-app views (list / grid / compact) with real icons.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9370;
const OUT = 'E:\\CacheSweep\\docs\\';

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=C:\\Windows\\Temp\\cs-views-${Date.now()}`,
  '--window-size=1400,1400',
  'http://127.0.0.1:5188/',
], { stdio: 'ignore' });

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* starting */ }
    await sleep(250);
  }
  throw new Error('CDP unavailable');
}

const ws = new WebSocket(await endpoint());
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  const cb = pending.get(msg.id);
  if (cb) { pending.delete(msg.id); cb(msg); }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send('Page.enable');
await send('Runtime.enable');
await sleep(1700);

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const d = res.result?.exceptionDetails;
  if (d) throw new Error(d.exception?.description || d.text);
  return res.result?.result?.value;
}

async function waitFor(expr, label, tries = 300) {
  for (let i = 0; i < tries; i++) {
    if (await evaluate(expr)) return;
    await sleep(300);
  }
  throw new Error(`timeout: ${label}`);
}

async function shoot(file, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(OUT + file, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', file);
}

/* Dark theme, open the disk view and load apps. */
await evaluate(`document.querySelector('#theme-switch [data-theme-value="dark"]').click()`);
await sleep(400);
await evaluate(`document.getElementById('tab-disk').click()`);
await waitFor(`document.querySelectorAll('#drives .drive-card').length > 0`, 'drive cards');
await waitFor(`document.querySelectorAll('#apps-list .app-row').length > 0`, 'app rows', 400);
await sleep(700);

const stats = await evaluate(`JSON.stringify({
  rows: document.querySelectorAll('#apps-list .app-row').length,
  icons: document.querySelectorAll('#apps-list img.app-icon').length,
  letters: document.querySelectorAll('#apps-list .app-icon-letter').length,
  note: document.getElementById('apps-note').textContent,
})`);
console.log('list view:', stats);
await shoot('view-apps-list.png', 1200);

/* Grid view. */
await evaluate(`document.querySelector('#apps-view-switch [data-view="grid"]').click()`);
await sleep(600);
await shoot('view-apps-grid.png', 1100);

/* Compact view. */
await evaluate(`document.querySelector('#apps-view-switch [data-view="compact"]').click()`);
await sleep(600);
await shoot('view-apps-compact.png', 900);

ws.close();
browser.kill();
console.log('done');
