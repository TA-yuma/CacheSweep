// Verify the pinned header stays fixed on scroll, and font style switching works.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9395;

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=C:\\Windows\\Temp\\cs-sticky-${Date.now()}`,
  '--window-size=1400,900',
  // Test embedded mode to reproduce the desktop shell exactly.
  'http://127.0.0.1:5188/?embed=1',
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
const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  }
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
await sleep(4000);

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const d = res.result?.exceptionDetails;
  if (d) throw new Error(d.exception?.description || d.text);
  return res.result?.result?.value;
}

// 1. Check embedded class applied and topbar position.
const embedded = await evaluate(`document.documentElement.classList.contains('embedded')`);
const position = await evaluate(`getComputedStyle(document.querySelector('.topbar')).position`);
console.log('embedded class:', embedded);
console.log('topbar position:', position);

// 2. Scroll the page and confirm the topbar stays at top.
await evaluate(`window.scrollTo(0, 800)`);
await sleep(400);
const topAfterScroll = await evaluate(`Math.round(document.querySelector('.topbar').getBoundingClientRect().top)`);
console.log('topbar top after scroll (should be 0):', topAfterScroll);

// 3. Font style: switch to 宋体 and 楷体.
const options = await evaluate(`JSON.stringify([...document.querySelectorAll('#font-family-select option')].map(o => o.value))`);
console.log('font options:', options);

await evaluate(`document.getElementById('font-family-select').value = 'songti'; document.getElementById('font-family-select').dispatchEvent(new Event('change'))`);
await sleep(300);
const songti = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim()`);
console.log('font-ui (songti):', songti.slice(0, 40));

await evaluate(`document.getElementById('font-family-select').value = 'kaiti'; document.getElementById('font-family-select').dispatchEvent(new Event('change'))`);
await sleep(300);
const kaiti = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim()`);
console.log('font-ui (kaiti):', kaiti.slice(0, 40));

console.log('--- JS errors ---');
console.log(errors.join('\n') || '(none)');

ws.close();
browser.kill();
console.log('done');