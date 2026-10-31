import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9400;

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=C:\\Windows\\Temp\\cs-dev-${Date.now()}`,
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
    await sleep(300);
  }
  throw new Error('CDP unavailable');
}

const ws = new WebSocket(await endpoint());
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  const cb = pending.get(m.id);
  if (cb) { pending.delete(m.id); cb(m); }
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
await sleep(3000);

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return res.result?.result?.value;
}

// Get the raw HTML from the document to see the developer name bytes.
const aboutHtml = await evaluate(`document.querySelector('#view-settings').querySelector('.card-sub')?.outerHTML`);
console.log('about card-sub innerHTML:', aboutHtml);

// Switch to settings tab and read rendered developer name.
await evaluate(`document.getElementById('tab-settings').click()`);
await sleep(400);
const devText = await evaluate(`[...document.querySelectorAll('#view-settings .card-sub')].map(e => e.textContent).join(' | ')`);
console.log('settings card-sub text (all):', devText);

ws.close();
browser.kill();
console.log('done');