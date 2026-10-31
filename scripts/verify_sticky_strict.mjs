// Strict verification: scroll and confirm the top bar stays pinned in BOTH
// normal and embedded modes, sampling position at multiple scroll depths.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9410;

async function runScenario(mode, port) {
  const url = mode === 'embedded'
    ? 'http://127.0.0.1:5188/?embed=1'
    : 'http://127.0.0.1:5188/';
  const browser = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=C:\\Windows\\Temp\\cs-${mode}-${Date.now()}`,
    '--window-size=1400,900', url,
  ], { stdio: 'ignore' });

  async function endpoint() {
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json`);
        const list = await res.json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      } catch {}
      await sleep(300);
    }
    throw new Error('CDP unavailable');
  }
  const ws = new WebSocket(await endpoint());
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); const cb = pending.get(m.id); if (cb) { pending.delete(m.id); cb(m); } });
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await sleep(3600);
  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return res.result?.result?.value;
  }

  // Generate enough content to make the page scrollable.
  await evaluate(`document.getElementById('tab-disk').click()`);
  await evaluate(`document.getElementById('tab-sweep').click()`);
  await sleep(500);

  const positions = [];
  for (const depth of [0, 200, 400, 800, 1200]) {
    await evaluate(`window.scrollTo(0, ${depth})`);
    await sleep(200);
    const top = await evaluate(`Math.round(document.querySelector('.topbar').getBoundingClientRect().top)`);
    const pos = await evaluate(`getComputedStyle(document.querySelector('.topbar')).position`);
    const scrollY = await evaluate(`window.scrollY`);
    positions.push({ scrollY, top, pos });
  }

  ws.close(); browser.kill();
  return positions;
}

const normal = await runScenario('normal', PORT);
const embedded = await runScenario('embedded', PORT + 1);

console.log('=== normal mode ===');
normal.forEach(p => console.log(`  scrollY=${p.scrollY}  topbarTop=${p.top}  position=${p.pos}`));
console.log('=== embedded mode ===');
embedded.forEach(p => console.log(`  scrollY=${p.scrollY}  topbarTop=${p.top}  position=${p.pos}`));

const normalOk = normal.every(p => p.top === 0);
const embeddedOk = embedded.every(p => p.top === 0);
console.log(`\nnormal pinned: ${normalOk}`);
console.log(`embedded pinned: ${embeddedOk}`);
console.log('done');