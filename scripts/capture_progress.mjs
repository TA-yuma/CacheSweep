// Captures the clean progress panel mid-run and after completion.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9360;
const OUT = 'E:\\CacheSweep\\docs\\';

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=C:\\Windows\\Temp\\cs-prog-${Date.now()}`,
  '--window-size=1400,1200',
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
await send('Emulation.setDeviceMetricsOverride', {
  width: 1400, height: 1000, deviceScaleFactor: 2, mobile: false,
});
await sleep(1800);
// Force the dark theme: these shots go into the README, which uses dark.
await evaluate(`document.querySelector('#theme-switch [data-theme-value="dark"]').click()`);
await sleep(500);

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const d = res.result?.exceptionDetails;
  if (d) throw new Error(d.exception?.description || d.text);
  return res.result?.result?.value;
}

async function shoot(file) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(OUT + file, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', file);
}

/* Populate the panel with a realistic mid-run state directly, so the capture is
   deterministic instead of racing a fast clean. */
await evaluate(`
  openProgress(false);
  const demo = [
    { percent: 12, index: 1, total: 8, freedBytes: 97742065, deletedFiles: 113, failures: 0,
      currentName: '用户临时文件', currentSuccess: true, currentBytes: 97742065 },
    { percent: 25, index: 2, total: 8, freedBytes: 97742065, deletedFiles: 113, failures: 0,
      currentName: 'Windows 临时文件', currentSuccess: true, currentBytes: 0 },
    { percent: 37, index: 3, total: 8, freedBytes: 97742065, deletedFiles: 113, failures: 0,
      currentName: '崩溃转储文件', currentSuccess: true, currentBytes: 0 },
    { percent: 50, index: 4, total: 8, freedBytes: 97742065, deletedFiles: 113, failures: 1,
      currentName: 'Windows 错误报告', currentSuccess: false, currentError: '目录被占用' },
    { percent: 62, index: 5, total: 8, freedBytes: 98819313, deletedFiles: 138, failures: 1,
      currentName: 'DirectX 着色器缓存', currentSuccess: true, currentBytes: 1077248 },
  ];
  for (const e of demo) updateProgress(e);
`);
await sleep(600);
await shoot('progress-running.png');

/* Then the finished state. */
await evaluate(`
  for (const e of [
    { percent: 75, index: 6, total: 8, freedBytes: 135083834, deletedFiles: 143, failures: 1,
      currentName: 'Windows 更新缓存', currentSuccess: true, currentBytes: 36158336 },
    { percent: 87, index: 7, total: 8, freedBytes: 167505606, deletedFiles: 149, failures: 1,
      currentName: '组件服务日志', currentSuccess: true, currentBytes: 32421772 },
    { percent: 100, index: 8, total: 8, freedBytes: 167836898, deletedFiles: 275, failures: 1,
      currentName: 'VS Code 日志', currentSuccess: true, currentBytes: 331292 },
  ]) updateProgress(e);
  finishProgress({ durationMs: 4820, freedBytes: 167836898 }, false);
`);
await sleep(700);
await shoot('progress-done.png');

ws.close();
browser.kill();
console.log('done');
