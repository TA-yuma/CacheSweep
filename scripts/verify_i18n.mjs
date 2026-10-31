// Verify i18n switching, font settings, and boot animation work without JS errors.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9390;

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=C:\\Windows\\Temp\\cs-i18n-${Date.now()}`,
  '--window-size=1400,1000',
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
const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push('ERR: ' + m.params.args.map(a => a.value || a.description).join(' '));
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
await sleep(4500);

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const d = res.result?.exceptionDetails;
  if (d) throw new Error(d.exception?.description || d.text);
  return res.result?.result?.value;
}

// Check that boot overlay is gone (animation finished) and title translated.
const bootGone = await evaluate(`!document.getElementById('boot-overlay')`);
const tabText = await evaluate(`document.getElementById('tab-sweep').textContent`);
console.log('boot overlay gone:', bootGone);
console.log('tab-sweep zh:', tabText);

// Switch to English.
await evaluate(`document.getElementById('lang-select').value = 'en'; document.getElementById('lang-select').dispatchEvent(new Event('change'))`);
await sleep(500);
const tabEn = await evaluate(`document.getElementById('tab-sweep').textContent`);
const scanBtnEn = await evaluate(`document.getElementById('btn-scan').textContent`);
console.log('tab-sweep en:', tabEn);
console.log('btn-scan en:', scanBtnEn);

// Switch to Russian.
await evaluate(`document.getElementById('lang-select').value = 'ru'; document.getElementById('lang-select').dispatchEvent(new Event('change'))`);
await sleep(500);
const tabRu = await evaluate(`document.getElementById('tab-sweep').textContent`);
console.log('tab-sweep ru:', tabRu);

// Test font size setting.
await evaluate(`document.getElementById('font-size-select').value = 'large'; document.getElementById('font-size-select').dispatchEvent(new Event('change'))`);
await sleep(300);
const rootFont = await evaluate(`getComputedStyle(document.documentElement).fontSize`);
console.log('root font-size (large):', rootFont);

// Test font family.
await evaluate(`document.getElementById('font-family-select').value = 'mono'; document.getElementById('font-family-select').dispatchEvent(new Event('change'))`);
await sleep(300);
const fontUi = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim()`);
console.log('font-ui (mono):', fontUi.slice(0, 40));

console.log('--- JS errors ---');
console.log(errors.join('\n') || '(none)');

ws.close();
browser.kill();
console.log('done');