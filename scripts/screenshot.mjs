// Drives the CacheSweep UI through the Chrome DevTools Protocol to produce
// documentation screenshots for every theme and view.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const BASE = 'http://127.0.0.1:5188/';
const OUT = 'E:\\CacheSweep\\docs\\';

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:\\Windows\\Temp\\cs-cdp-shots',
  '--window-size=1400,1400',
  BASE,
], { stdio: 'ignore' });

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error('CDP never came up');
}

const ws = new WebSocket(await wsUrl());
let seq = 0;
const waiting = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  const cb = waiting.get(msg.id);
  if (cb) { waiting.delete(msg.id); cb(msg); }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send('Page.enable');
await send('Runtime.enable');
await sleep(1500);

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (res.result?.exceptionDetails) {
    const d = res.result.exceptionDetails;
    throw new Error((d.exception && d.exception.description) || d.text);
  }
  return res.result?.result?.value;
}

async function shoot(file, height = 1500) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(500);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(OUT + file, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', file);
}

async function waitFor(expr, label, tries = 120) {
  for (let i = 0; i < tries; i++) {
    if (await evaluate(expr)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/* 1. dark theme, scanned list */
await evaluate(`document.querySelector('#theme-switch [data-theme-value="dark"]').click()`);
await sleep(500);
await evaluate(`document.getElementById('btn-scan').click()`);
await waitFor(`document.querySelectorAll('#list .row').length > 0`, 'rows');
await sleep(700);
await shoot('screenshot.png', 1560);

/* 2. preview modal */
await evaluate(`document.getElementById('btn-select-safe').click()`);
await sleep(250);
await evaluate(`document.getElementById('btn-preview').click()`);
await sleep(700);
await shoot('screenshot-preview.png', 1000);
await evaluate(`document.getElementById('modal-cancel').click()`);

/* 3. light theme */
await evaluate(`document.getElementById('theme-switch').querySelector('[data-theme-value="light"]').click()`);
await sleep(800);
await shoot('theme-light.png', 1560);

/* 4. transparent theme */
await evaluate(`document.getElementById('theme-switch').querySelector('[data-theme-value="transparent"]').click()`);
await sleep(800);
await shoot('theme-transparent.png', 1560);

/* 5. disk usage view (back to dark) */
await evaluate(`document.getElementById('theme-switch').querySelector('[data-theme-value="dark"]').click()`);
await sleep(400);
await evaluate(`document.getElementById('tab-disk').click()`);
await sleep(1200);
await evaluate(`document.getElementById('btn-load-apps').click()`);
await waitFor(`document.querySelectorAll('#apps-list .inv-row').length > 0`, 'apps inventory');
await sleep(600);
await shoot('view-disk.png', 1560);

/* 6. rules view: whitelist / blacklist */
await evaluate(`document.getElementById('tab-rules').click()`);
await waitFor(`document.querySelectorAll('#rules-list .rule-row').length > 0`, 'rules');
await sleep(700);
await shoot('view-rules.png', 1560);

/* 7. settings view */
await evaluate(`document.getElementById('tab-settings').click()`);
await sleep(500);
await shoot('view-settings.png', 900);

/* leave the user's preference on dark */
await evaluate(`localStorage.setItem('cachesweep.theme','dark')`);

ws.close();
browser.kill();
console.log('done');
