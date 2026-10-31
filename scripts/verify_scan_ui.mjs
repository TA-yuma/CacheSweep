// Verify the big scan button and the scan-drive dropdown.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9420;
const OUT = 'E:\\CacheSweep\\docs\\';

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=C:\\Windows\\Temp\\cs-f15-${Date.now()}`,
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
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  const cb = pending.get(m.id); if (cb) { pending.delete(m.id); cb(m); }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await sleep(4000);

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const d = res.result?.exceptionDetails;
  if (d) throw new Error(d.exception?.description || d.text);
  return res.result?.result?.value;
}

// Big scan button present and visible in the empty state.
const bigScanVisible = await evaluate(`(() => {
  const b = document.getElementById('btn-big-scan');
  const empty = document.getElementById('empty');
  return Boolean(b) && !empty.hidden;
})()`);
const bigScanText = await evaluate(`document.getElementById('btn-big-scan')?.querySelector('.big-scan-label')?.textContent`);
console.log('big scan visible:', bigScanVisible, 'label:', bigScanText);

// Screenshot the empty state with the big button.
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(400);
const shot = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(OUT + 'view-big-scan.png', Buffer.from(shot.result.data, 'base64'));
console.log('saved view-big-scan.png');

// Open the scan-drive dropdown.
await evaluate(`document.getElementById('btn-scan-drive').click()`);
await sleep(600);
const menuVisible = await evaluate(`!document.getElementById('scan-drive-menu').hidden`);
const menuItems = await evaluate(`document.querySelectorAll('#scan-drive-menu button').length`);
console.log('dropdown visible:', menuVisible, 'items:', menuItems);

// Capture with dropdown open.
const shot2 = await send('Page.captureScreenshot', { format: 'png' });
await writeFile(OUT + 'view-scan-drive-menu.png', Buffer.from(shot2.result.data, 'base64'));
console.log('saved view-scan-drive-menu.png');

console.log('--- JS errors ---');
console.log(errors.join('\n') || '(none)');

ws.close(); browser.kill();
console.log('done');