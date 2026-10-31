"use strict";

/**
 * Compact toolbar mode.
 *
 * The desktop shell opens /?mode=compact for the floating window. This renders
 * a reduced HUD: free space per drive, a one-click cache clean, and a link back
 * to the full window. Everything heavy (rules, plugins, per-app analysis)
 * stays in the full window — the toolbar is for glancing and quick action.
 */

const compactState = {
  drives: [],
  busy: false,
  dryRun: false,
};

function isCompactMode() {
  return new URLSearchParams(location.search).get("mode") === "compact";
}

async function compactInit() {
  if (!isCompactMode()) {
    return;
  }

  document.documentElement.classList.add("compact-mode");
  document.body.classList.add("compact-body");

  renderCompactShell();
  await refreshCompact();
}

function renderCompactShell() {
  document.body.innerHTML = `
    <div class="compact-wrap">
      <div class="compact-drive" id="compact-drive">
        <div class="compact-drive-row">
          <span class="compact-drive-name">—</span>
          <span class="compact-drive-free">—</span>
        </div>
        <div class="compact-bar"><span style="width:0%"></span></div>
      </div>

      <div class="compact-stat">
        <span class="compact-stat-label">可清理</span>
        <span class="compact-stat-value" id="compact-reclaimable">—</span>
      </div>

      <div class="compact-actions">
        <button class="btn primary sm" id="compact-clean">快速清理</button>
        <button class="btn ghost sm" id="compact-scan">体检</button>
        <button class="btn ghost sm compact-expand" id="compact-expand" title="展开完整窗口">⤢</button>
      </div>

      <div class="compact-status" id="compact-status">就绪</div>
    </div>`;

  document.getElementById("compact-scan").addEventListener("click", compactScan);
  document.getElementById("compact-clean").addEventListener("click", compactClean);
  document.getElementById("compact-expand").addEventListener("click", expandToFull);
}

/** Asks the desktop shell to switch back to the full window. */
function expandToFull() {
  try {
    window.chrome?.webview?.postMessage({ action: "expand" });
  } catch {
    /* plain browser: fall back to the full page */
    location.href = "/";
  }
}

function setCompactStatus(text) {
  const el = document.getElementById("compact-status");
  if (el) el.textContent = text;
}

async function refreshCompact() {
  try {
    compactState.drives = await api("/api/inventory/drives");
    renderCompactDrive();
  } catch (err) {
    setCompactStatus(`读取磁盘失败：${err.message}`);
  }

  // Reclaimable size comes from the cache-only rule set, which is exactly what
  // the quick clean acts on.
  try {
    const report = await api("/api/scan", { method: "POST" });
    const safe = report.items
      .filter((i) => i.status === "ok" && i.risk === "Safe")
      .reduce((sum, i) => sum + i.bytes, 0);

    const el = document.getElementById("compact-reclaimable");
    if (el) el.textContent = formatBytesCompact(safe);
    setCompactStatus("就绪");
  } catch {
    setCompactStatus("扫描失败");
  }
}

function renderCompactDrive() {
  const drive = compactState.drives[0];
  if (!drive) {
    return;
  }

  const pct = drive.totalBytes ? (drive.usedBytes / drive.totalBytes) * 100 : 0;

  const wrap = document.getElementById("compact-drive");
  if (!wrap) return;

  wrap.querySelector(".compact-drive-name").textContent = `${drive.name}`;
  wrap.querySelector(".compact-drive-free").textContent =
    `${formatBytesCompact(drive.freeBytes)} 可用`;
  wrap.querySelector(".compact-bar span").style.width = `${pct.toFixed(1)}%`;
}

function formatBytesCompact(n) {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function compactScan() {
  if (compactState.busy) return;
  compactState.busy = true;
  setCompactStatus("扫描中…");
  await refreshCompact();
  compactState.busy = false;
}

/**
 * Quick clean: dry-run first so the user sees the number, then a real run.
 * Only Safe-rated cache rules are touched, matching the toolbar's promise.
 */
async function compactClean() {
  if (compactState.busy) return;
  compactState.busy = true;

  const button = document.getElementById("compact-clean");
  button.disabled = true;

  try {
    setCompactStatus("正在统计…");
    const report = await api("/api/scan", { method: "POST" });
    const ids = report.items
      .filter((i) => i.status === "ok" && i.risk === "Safe" && i.bytes > 0)
      .map((i) => i.id);

    if (ids.length === 0) {
      setCompactStatus("没有可清理的安全项");
      return;
    }

    setCompactStatus(`清理 ${ids.length} 项…`);
    const result = await api("/api/clean", {
      method: "POST",
      body: JSON.stringify({
        targetIds: ids,
        dryRun: false,
        useRecycleBin: true,
        allowDangerous: false,
      }),
    });

    setCompactStatus(
      `已释放 ${formatBytesCompact(result.totalFreedBytes)}` +
        (result.failures ? ` · ${result.failures} 项失败` : "")
    );

    await new Promise((r) => setTimeout(r, 700));
    await refreshCompact();
  } catch (err) {
    setCompactStatus(`清理失败：${err.message}`);
  } finally {
    button.disabled = false;
    compactState.busy = false;
  }
}

window.addEventListener("DOMContentLoaded", compactInit);
