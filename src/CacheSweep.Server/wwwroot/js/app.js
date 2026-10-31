"use strict";

/* CacheSweep browser UI.
 * Talks only to the local API; it never touches the file system itself.
 * The server accepts rule ids, never paths, so a compromised page can only act
 * on targets that already exist in the rule set. */

const CATEGORY_LABEL = {
  TempFiles: "临时文件",
  BrowserCache: "浏览器缓存",
  AppCache: "应用缓存",
  SystemCache: "系统缓存",
  DeveloperCache: "开发者缓存",
  CrashAndDiagnostics: "崩溃与诊断",
  RecycleBin: "回收站",
};

const RISK_LABEL = { Safe: "安全", Caution: "需确认", Dangerous: "高风险" };

const state = {
  scan: null,
  selected: new Set(),
  busy: false,
  pendingAction: null,
  rules: [],
  theme: "dark",
  inventoryLoaded: { apps: false, files: false, folders: false, drives: false },
};

const $ = (id) => document.getElementById(id);

/* ---------------- formatting ---------------- */

function formatBytes(n) {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return "";
  }
}

function setStatus(text, spinning = false) {
  $("status").innerHTML = spinning
    ? `<span class="spinner"></span><span>${text}</span>`
    : `<span>${text}</span>`;
}

function showBanner(kind, html) {
  const el = $("banner");
  el.className = `banner ${kind}`;
  el.innerHTML = html;
  el.hidden = false;
}

function hideBanner() {
  $("banner").hidden = true;
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return body;
}

/* ---------------- theme ---------------- */

const THEME_KEY = "cachesweep.theme";

function applyTheme(theme, persist = true) {
  const normalized = ["dark", "light", "transparent"].includes(theme) ? theme : "dark";
  document.documentElement.setAttribute("data-theme", normalized);
  state.theme = normalized;

  document.querySelectorAll("#theme-switch button").forEach((b) => {
    b.classList.toggle("active", b.dataset.themeValue === normalized);
  });

  const sel = $("theme-select");
  if (sel) sel.value = normalized;

  applyThemeIcon(normalized);

  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, normalized);
    } catch {
      /* private mode */
    }
    // Remember server-side too so the desktop shell can match its window.
    api("/api/preferences/theme", {
      method: "POST",
      body: JSON.stringify({ theme: normalized }),
    }).catch(() => {});

    notifyHost(normalized);
  }
}

/**
 * Each theme owns a fruit icon. Swapping the favicon and the in-page logo keeps
 * the browser tab, the window and the taskbar consistent with the chosen theme.
 */
const THEME_FRUIT = {
  dark: "orange",
  transparent: "grape",
  light: "sugarcane",
};

function applyThemeIcon(theme) {
  const fruit = THEME_FRUIT[theme] || "orange";

  document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((link) => {
    const isIco = link.getAttribute("href")?.endsWith(".ico") || link.getAttribute("sizes") === "any";
    link.setAttribute("href", isIco ? `/assets/themes/fruit-${fruit}.ico` : `/assets/fruit-${fruit}.png`);
  });

  document.querySelectorAll(".logo-img, .empty-logo").forEach((img) => {
    img.setAttribute("src", `/assets/fruit-${fruit}.png`);
  });

  // Lets the desktop shell pick the matching taskbar/tray icon.
  document.documentElement.dataset.fruit = fruit;
}

/**
 * Tells the desktop shell (WebView2 host) about the active theme so it can
 * recolour the native title bar and switch the window to real acrylic.
 * No-op in a normal browser.
 */
function notifyHost(theme) {
  try {
    if (window.chrome?.webview?.postMessage) {
      window.chrome.webview.postMessage({ theme });
    }
  } catch {
    /* not embedded */
  }
}

/* ---------------- views ---------------- */

function showView(name) {
  for (const v of ["sweep", "disk", "rules", "settings"]) {
    $(`view-${v}`).hidden = v !== name;
  }
  document.querySelectorAll(".nav button").forEach((b) => {
    const active = b.id === `tab-${name}`;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
  });
  $("btn-scan").hidden = name !== "sweep";

  if (name === "disk" && !state.inventoryLoaded.drives) {
    loadDrives();
  }
  if (name === "rules" && state.rules.length === 0) {
    loadRules();
  }
}

/* ---------------- sweep: rendering ---------------- */

function renderSummary(scan) {
  $("summary").hidden = false;
  $("machine").hidden = false;
  $("machine").textContent = scan.machineName;

  $("total-size").textContent = formatBytes(scan.totals.bytes);
  $("safe-size").textContent = formatBytes(scan.totals.safeBytes);
  $("caution-size").textContent = formatBytes(scan.totals.cautionBytes);
  $("danger-size").textContent = formatBytes(scan.totals.dangerousBytes);
  $("scan-time").textContent = `${(scan.scanDurationMs / 1000).toFixed(2)} s`;

  const total = scan.totals.bytes || 1;
  $("split-safe").style.width = `${(scan.totals.safeBytes / total) * 100}%`;
  $("split-caution").style.width = `${(scan.totals.cautionBytes / total) * 100}%`;
  $("split-danger").style.width = `${(scan.totals.dangerousBytes / total) * 100}%`;
}

function renderList() {
  const list = $("list");
  list.innerHTML = "";
  if (!state.scan) return;

  $("toolbar").hidden = false;

  const items = [...state.scan.items]
    .filter((i) => i.status !== "missing" && i.status !== "ignored")
    .sort((a, b) => {
      if (a.bytes !== b.bytes) return b.bytes - a.bytes;
      return a.id.localeCompare(b.id);
    });

  if (items.length === 0) {
    list.innerHTML =
      '<div class="empty"><p>没有发现可清理的缓存目录</p><p class="hint">这是好事，说明没有已知缓存被占用</p></div>';
    return;
  }

  items.forEach((item, index) => {
    const selectable = item.status === "ok";
    const checked = state.selected.has(item.id);

    const row = document.createElement("div");
    row.className = `row${checked ? " selected" : ""}${selectable ? "" : " disabled"}`;
    row.dataset.risk = item.risk;
    row.style.animationDelay = `${Math.min(index * 26, 320)}ms`;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    cb.disabled = !selectable;
    cb.setAttribute("aria-label", item.name);
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      if (cb.checked) state.selected.add(item.id);
      else state.selected.delete(item.id);
      row.classList.toggle("selected", cb.checked);
      updateButtons();
    });

    const main = document.createElement("div");
    main.className = "row-main";

    const title = document.createElement("div");
    title.className = "row-title";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = item.name;
    title.appendChild(nameSpan);

    const riskBadge = document.createElement("span");
    riskBadge.className = `badge ${item.risk}`;
    riskBadge.textContent = RISK_LABEL[item.risk] || item.risk;
    title.appendChild(riskBadge);

    const catBadge = document.createElement("span");
    catBadge.className = "badge cat";
    catBadge.textContent = CATEGORY_LABEL[item.category] || item.category;
    title.appendChild(catBadge);

    if (item.status === "in-use") {
      const st = document.createElement("span");
      st.className = "badge status-in-use";
      st.textContent = "正在使用";
      st.title = "相关程序正在运行，清理前请先关闭";
      title.appendChild(st);
    } else if (item.status === "blocked") {
      const st = document.createElement("span");
      st.className = "badge status-blocked";
      st.textContent = "已阻止";
      title.appendChild(st);
    }

    const desc = document.createElement("div");
    desc.className = "row-desc";
    desc.textContent = item.description;

    const path = document.createElement("div");
    path.className = "row-path";
    path.textContent = item.path;
    path.title = item.path;

    main.append(title, desc, path);

    const size = document.createElement("div");
    size.className = "row-size";
    const bytes = document.createElement("div");
    bytes.className = "bytes";
    bytes.textContent = formatBytes(item.bytes);
    const files = document.createElement("div");
    files.className = "files";
    files.textContent = `${item.fileCount.toLocaleString("zh-CN")} 个文件`;
    size.append(bytes, files);

    if (selectable) {
      row.addEventListener("click", () => {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change"));
      });
    }

    row.append(cb, main, size);
    list.appendChild(row);
  });

  updateButtons();
}

function updateButtons() {
  const n = state.selected.size;
  $("btn-clean").disabled = n === 0 || state.busy;
  $("btn-preview").disabled = n === 0 || state.busy;
  $("btn-select-safe").disabled = !state.scan || state.busy;
  $("btn-clear").disabled = n === 0 || state.busy;
  $("btn-scan").disabled = state.busy;
  $("btn-clean").textContent = n === 0 ? "执行清理" : `执行清理 (${n})`;
}

/* ---------------- sweep: actions ---------------- */

async function scan() {
  if (state.busy) return;
  showView("sweep");
  state.busy = true;
  state.selected.clear();
  updateButtons();
  hideBanner();
  $("empty").hidden = true;
  $("list").innerHTML = "";
  $("scanbar").hidden = false;
  setStatus("正在扫描目录体积…", true);

  try {
    const data = await api("/api/scan", { method: "POST" });
    state.scan = data;
    renderSummary(data);
    renderList();

    const active = data.items.filter((i) => i.status !== "missing" && i.bytes > 0);
    const inUse = data.items.filter((i) => i.status === "in-use").length;
    const ignored = data.items.filter((i) => i.status === "ignored").length;

    showBanner(
      data.totals.bytes > 0 ? "info" : "ok",
      data.totals.bytes > 0
        ? `扫描完成：<strong>${active.length}</strong> 个有内容的缓存目录，合计 <strong>${formatBytes(
            data.totals.bytes
          )}</strong>，用时 ${(data.scanDurationMs / 1000).toFixed(2)}s。` +
            (inUse ? ` 其中 ${inUse} 项因程序正在运行而不可清理。` : "") +
            (ignored ? ` ${ignored} 项在你的黑名单中已跳过。` : "") +
            ` 勾选后先「预览清理」，再执行。`
        : "扫描完成：未发现可清理的缓存。"
    );
    setStatus("就绪");
  } catch (err) {
    showBanner("error", `扫描失败：${err.message}`);
    setStatus("扫描失败");
  } finally {
    state.busy = false;
    $("scanbar").hidden = true;
    updateButtons();
  }
}

function requestClean(dryRun) {
  const ids = [...state.selected];
  if (ids.length === 0) return;

  const chosen = state.scan.items.filter((i) => ids.includes(i.id));
  const dangerous = chosen.filter((i) => i.risk === "Dangerous");
  const reclaim = chosen.reduce((s, i) => s + i.bytes, 0);
  const recycle = $("use-recycle").checked;

  const items = chosen
    .slice(0, 14)
    .map((i) => `<li>${i.name} — <strong>${formatBytes(i.bytes)}</strong></li>`)
    .join("");

  const more = chosen.length > 14 ? `<li class="muted">…及其他 ${chosen.length - 14} 项</li>` : "";

  const body = `
    <p>将处理 <strong>${chosen.length}</strong> 个目标，预计释放 <strong>${formatBytes(reclaim)}</strong>。</p>
    <ul>${items}${more}</ul>
    ${
      dangerous.length
        ? `<p style="color:var(--danger)">⚠ 包含高风险项：${dangerous
            .map((d) => d.name)
            .join("、")}。请确认其中没有你还需要的数据。</p>`
        : ""
    }
    <p class="muted">${recycle ? "✓ 文件将移入回收站，可以恢复。" : "⚠ 文件将被永久删除，无法恢复！"}</p>
    <p class="muted">${dryRun ? "本次为预览：只统计，不删除任何文件。" : "本次为实际操作：将立即删除。"}</p>
  `;

  $("modal-ok").className = dryRun ? "btn primary" : "btn danger";
  openModal(
    dryRun ? "预览清理" : "确认执行清理",
    body,
    async () => {
      closeModal();
      await runClean(ids, dryRun);
    },
    dryRun ? "生成预览" : "确认执行"
  );
}

async function runClean(ids, dryRun) {
  state.busy = true;
  updateButtons();
  setStatus(dryRun ? "生成预览中…" : "清理中…", true);

  try {
    const result = await api("/api/clean", {
      method: "POST",
      body: JSON.stringify({
        targetIds: ids,
        dryRun,
        useRecycleBin: $("use-recycle").checked,
        allowDangerous: true, // the modal already demanded explicit confirmation
      }),
    });

    const failed = result.items.filter((i) => !i.success);
    const lines = result.items
      .map(
        (i) =>
          `<li>${i.success ? "✓" : "✗"} ${i.name} — ${formatBytes(i.freedBytes)}` +
          `${i.error ? ` <span style="color:var(--caution)">（${i.error}）</span>` : ""}</li>`
      )
      .join("");

    showBanner(
      dryRun ? "info" : failed.length ? "warn" : "ok",
      `<strong>${dryRun ? "预览结果" : "清理完成"}</strong>：` +
        `${dryRun ? "可释放" : "已释放"} <strong>${formatBytes(result.totalFreedBytes)}</strong>，` +
        `涉及 ${result.totalDeletedFiles.toLocaleString("zh-CN")} 个文件，` +
        `用时 ${(result.durationMs / 1000).toFixed(2)}s。` +
        (failed.length ? ` 失败 ${failed.length} 项。` : "") +
        `<ul>${lines}</ul>` +
        (dryRun ? `<p>确认无误后点击「执行清理」。</p>` : "")
    );

    if (!dryRun) {
      state.busy = false;
      await scan();
      return;
    }
    setStatus("预览完成");
  } catch (err) {
    showBanner("error", `清理失败：${err.message}`);
    setStatus("清理失败");
  } finally {
    state.busy = false;
    updateButtons();
  }
}

/* ---------------- disk usage ---------------- */

function renderDrives(drives) {
  const wrap = $("drives");
  wrap.innerHTML = "";
  for (const d of drives) {
    const pct = d.totalBytes ? (d.usedBytes / d.totalBytes) * 100 : 0;
    const level = pct >= 92 ? "crit" : pct >= 80 ? "warn" : "";
    const el = document.createElement("div");
    el.className = "drive";
    el.innerHTML = `
      <div class="drive-top">
        <span>${d.name} ${d.label ? `· ${d.label}` : ""}</span>
        <span>${formatBytes(d.freeBytes)} 可用</span>
      </div>
      <div class="drive-bar ${level}"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="drive-top" style="margin-top:5px;font-size:11px;color:var(--text-faint)">
        <span>已用 ${formatBytes(d.usedBytes)}</span><span>共 ${formatBytes(d.totalBytes)}</span>
      </div>`;
    wrap.appendChild(el);
  }
}

async function loadDrives() {
  try {
    const drives = await api("/api/inventory/drives");
    renderDrives(drives);
    state.inventoryLoaded.drives = true;
  } catch (err) {
    showBanner("error", `读取磁盘信息失败：${err.message}`);
  }
}

function renderInventoryRows(container, rows) {
  container.innerHTML = "";
  if (rows.length === 0) {
    container.innerHTML = '<div class="empty" style="padding:32px"><p>没有数据</p></div>';
    return;
  }

  const max = Math.max(...rows.map((r) => r.bytes), 1);

  for (const r of rows) {
    const el = document.createElement("div");
    el.className = "inv-row";
    el.style.setProperty("--fill", `${((r.bytes / max) * 100).toFixed(1)}%`);
    el.innerHTML = `
      <div>
        <div class="inv-name">${escapeHtml(r.title)}</div>
        <div class="inv-sub" title="${escapeHtml(r.sub)}">${escapeHtml(r.sub)}</div>
      </div>
      <div class="inv-size">${formatBytes(r.bytes)}<small>${r.detail || ""}</small></div>`;
    container.appendChild(el);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadApps(force = false) {
  if (state.busy) return;
  if (state.inventoryLoaded.apps && !force) return;

  state.busy = true;
  setStatus("正在统计已安装程序…", true);
  $("apps-note").textContent = "统计中…（需要遍历安装目录，可能要十几秒）";
  $("apps-list").innerHTML = "";

  try {
    const data = await api("/api/inventory/apps");
    $("apps-total").textContent = formatBytes(data.totalBytes);
    $("apps-note").textContent = `${data.count} 个程序，用时 ${(data.durationMs / 1000).toFixed(1)}s`;

    renderInventoryRows(
      $("apps-list"),
      data.apps.map((a) => ({
        title: a.name,
        sub: a.installLocation + (a.locationMissing ? "  (目录已不存在)" : ""),
        bytes: a.bytes,
        detail: `${a.fileCount.toLocaleString("zh-CN")} 文件${a.publisher ? ` · ${a.publisher}` : ""}`,
      }))
    );
    state.inventoryLoaded.apps = true;
    setStatus("就绪");
  } catch (err) {
    $("apps-note").textContent = `统计失败：${err.message}`;
    setStatus("统计失败");
  } finally {
    state.busy = false;
  }
}

async function loadLargeFiles() {
  if (state.busy) return;
  state.busy = true;
  setStatus("正在查找大文件…", true);
  $("files-note").textContent = "扫描 C 盘中…";
  $("files-list").innerHTML = "";

  const minMb = Number($("file-min").value) || 100;

  try {
    const data = await api(`/api/inventory/large-files?root=C%3A%5C&minMb=${minMb}&take=50`);
    $("files-total").textContent = formatBytes(data.totalBytes);
    $("files-note").textContent = `找到 ${data.count} 个 ≥${minMb}MB 的文件`;

    renderInventoryRows(
      $("files-list"),
      data.files.map((f) => ({
        title: f.name,
        sub: f.path,
        bytes: f.bytes,
        detail: formatDate(f.lastWriteUtc),
      }))
    );
    state.inventoryLoaded.files = true;
    setStatus("就绪");
  } catch (err) {
    $("files-note").textContent = `扫描失败：${err.message}`;
    setStatus("扫描失败");
  } finally {
    state.busy = false;
  }
}

async function loadFolders() {
  if (state.busy) return;
  state.busy = true;
  setStatus("正在统计目录体积…", true);
  $("folders-note").textContent = "统计中…";
  $("folders-list").innerHTML = "";

  try {
    const data = await api("/api/inventory/folders?drive=C%3A%5C");
    const total = data.folders.reduce((s, f) => s + f.bytes, 0);
    $("folders-total").textContent = formatBytes(total);
    $("folders-note").textContent = `${data.folders.length} 个目录`;

    renderInventoryRows(
      $("folders-list"),
      data.folders.map((f) => ({
        title: f.name,
        sub: f.path,
        bytes: f.bytes,
        detail: `${f.fileCount.toLocaleString("zh-CN")} 文件`,
      }))
    );
    state.inventoryLoaded.folders = true;
    setStatus("就绪");
  } catch (err) {
    $("folders-note").textContent = `统计失败：${err.message}`;
    setStatus("统计失败");
  } finally {
    state.busy = false;
  }
}

/* ---------------- rules: whitelist / blacklist ---------------- */

async function loadRules() {
  try {
    const data = await api("/api/targets");
    state.rules = data.targets;
    drawRules();

    if (data.rejected.length) {
      showBanner(
        "warn",
        `有 ${data.rejected.length} 条规则未通过安全策略：` +
          data.rejected.map((r) => `<code>${escapeHtml(r.id)}</code> — ${escapeHtml(r.reason)}`).join("；")
      );
    }
  } catch (err) {
    showBanner("error", `加载规则失败：${err.message}`);
  }
}

function drawRules() {
  const { renderRuleList } = window.CacheSweepRules;
  renderRuleList($("rules-list"), state.rules, changeRuleList, removeCustomRule);
}

/** Moves one rule between the whitelist and the blacklist. */
async function changeRuleList(rule, enabled) {
  try {
    const data = await api("/api/targets/toggle", {
      method: "POST",
      body: JSON.stringify({ targetIds: [rule.id], enabled }),
    });
    state.rules = data.targets;
    drawRules();
    invalidateScan();
    setStatus(`「${rule.name}」已加入${enabled ? "白名单，可被清理" : "黑名单，不会被清理"}`);
  } catch (err) {
    showBanner("error", `修改失败：${err.message}`);
    throw err;
  }
}

/** A rule change changes what a scan measures, so the old report is stale. */
function invalidateScan() {
  state.scan = null;
  state.selected.clear();
  $("summary").hidden = true;
  $("toolbar").hidden = true;
  $("list").innerHTML = "";
  $("empty").hidden = false;
  $("empty").querySelector("p").textContent = "规则已修改，请重新体检";
}

async function moveAllRules(enabled, predicate = () => true) {
  const ids = state.rules.filter(predicate).map((r) => r.id);
  if (ids.length === 0) return;

  try {
    const data = await api("/api/targets/toggle", {
      method: "POST",
      body: JSON.stringify({ targetIds: ids, enabled }),
    });
    state.rules = data.targets;
    drawRules();
    invalidateScan();
    setStatus(`${ids.length} 条规则已移入${enabled ? "白名单" : "黑名单"}`);
  } catch (err) {
    showBanner("error", `操作失败：${err.message}`);
  }
}
async function addCustomRule() {
  const path = $("custom-path").value.trim();
  if (!path) {
    showBanner("warn", "请填写路径。");
    return;
  }

  try {
    await api("/api/targets/custom", {
      method: "POST",
      body: JSON.stringify({
        path,
        name: $("custom-name").value.trim() || null,
        risk: $("custom-risk").value,
        category: "AppCache",
      }),
    });
    $("custom-path").value = "";
    $("custom-name").value = "";
    showBanner("ok", "自定义规则已添加，默认为白名单。");
    await loadRules();
  } catch (err) {
    showBanner("error", `添加失败：${escapeHtml(err.message)}`);
  }
}

async function removeCustomRule(rule) {
  if (!confirm(`删除自定义规则「${rule.name}」？\n\n只会移除规则，不会删除任何文件。`)) return;

  try {
    await api(`/api/targets/custom/${encodeURIComponent(rule.id)}`, { method: "DELETE" });
    showBanner("ok", "规则已删除。");
    await loadRules();
  } catch (err) {
    showBanner("error", `删除失败：${err.message}`);
  }
}

/* ---------------- settings ---------------- */

async function showAudit() {
  try {
    const lines = await api("/api/audit");
    openModal(
      "最近操作",
      `<pre style="max-height:46vh;overflow:auto;font-family:var(--font-mono);font-size:11.5px;line-height:1.7;white-space:pre-wrap">${lines
        .slice(-60)
        .map(escapeHtml)
        .join("\n")}</pre>`,
      closeModal,
      "关闭"
    );
    $("modal-ok").className = "btn primary";
  } catch (err) {
    showBanner("error", `读取日志失败：${err.message}`);
  }
}

/* ---------------- modal ---------------- */

function openModal(title, bodyHtml, onConfirm, okLabel) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = bodyHtml;
  $("modal-ok").textContent = okLabel || "确认执行";
  $("confirm-modal").hidden = false;
  state.pendingAction = onConfirm;
}

function closeModal() {
  $("confirm-modal").hidden = true;
  state.pendingAction = null;
}

/* ---------------- wiring ---------------- */

$("btn-scan").addEventListener("click", scan);
$("btn-preview").addEventListener("click", () => requestClean(true));
$("btn-clean").addEventListener("click", () => requestClean(false));

$("tab-sweep").addEventListener("click", () => showView("sweep"));
$("tab-disk").addEventListener("click", () => showView("disk"));
$("tab-rules").addEventListener("click", () => showView("rules"));
$("tab-settings").addEventListener("click", () => showView("settings"));

/* Theme names. Each theme is named after the fruit whose colour it carries. */
const THEME_LABEL = {
  dark: "赤橙 · 暖橙主题",
  light: "青蔗 · 钢灰主题",
  transparent: "碧提 · 青提主题",
};

/* Replaces the native tooltip with an in-theme label chip. */
function installThemeTooltips() {
  document.querySelectorAll("#theme-switch button").forEach((b) => {
    const key = b.dataset.themeValue;
    const label = THEME_LABEL[key];
    if (!label) return;

    // Keep it accessible but stop the browser drawing its own tooltip.
    b.setAttribute("aria-label", label);
    b.dataset.tip = label;
    b.removeAttribute("title");

    if (!b.querySelector(".theme-tip")) {
      const tip = document.createElement("span");
      tip.className = "theme-tip";
      tip.setAttribute("aria-hidden", "true");
      tip.textContent = label;
      b.appendChild(tip);
    }
  });
}

installThemeTooltips();

document.querySelectorAll("#theme-switch button").forEach((b) => {
  b.addEventListener("click", () => applyTheme(b.dataset.themeValue));
});
$("theme-select").addEventListener("change", (e) => applyTheme(e.target.value));

$("modal-cancel").addEventListener("click", closeModal);
$("modal-ok").addEventListener("click", () => {
  const action = state.pendingAction;
  if (action) action();
});
$("confirm-modal").addEventListener("click", (e) => {
  if (e.target === $("confirm-modal")) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("confirm-modal").hidden) closeModal();
});

$("select-all").addEventListener("change", (e) => {
  state.selected.clear();
  if (e.target.checked && state.scan) {
    for (const item of state.scan.items) {
      if (item.status === "ok") state.selected.add(item.id);
    }
  }
  renderList();
});

$("btn-select-safe").addEventListener("click", () => {
  state.selected.clear();
  if (state.scan) {
    for (const item of state.scan.items) {
      if (item.status === "ok" && item.risk === "Safe") state.selected.add(item.id);
    }
  }
  renderList();
});

$("btn-clear").addEventListener("click", () => {
  state.selected.clear();
  renderList();
});

$("btn-load-apps").addEventListener("click", () => loadApps(true));
$("btn-load-files").addEventListener("click", loadLargeFiles);
$("btn-load-folders").addEventListener("click", loadFolders);

$("btn-white-all").addEventListener("click", () => moveAllRules(true));
$("btn-black-caution").addEventListener("click", () =>
  moveAllRules(false, (r) => r.risk === "Caution" && r.enabled)
);
$("btn-black-all").addEventListener("click", () => {
  if (!confirm("把所有规则都移入黑名单？清理功能将无内容可清。")) return;
  moveAllRules(false);
});
$("btn-add-custom").addEventListener("click", addCustomRule);
$("btn-show-audit").addEventListener("click", showAudit);

/* ---------------- boot ---------------- */

(function boot() {
  const stored = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(stored, false);

  // The server is the source of truth: another surface (desktop shell, a second
  // tab, or a restored profile) may have changed the theme. Reconcile on boot
  // so the page, the window icon and the tray icon never drift apart.
  api("/api/preferences")
    .then((prefs) => {
      if (prefs?.theme && prefs.theme !== state.theme) {
        applyTheme(prefs.theme, false);
        try {
          localStorage.setItem(THEME_KEY, prefs.theme);
        } catch {
          /* private mode */
        }
      }
      notifyHost(state.theme);
    })
    .catch(() => {
      notifyHost(state.theme);
    });

  // The desktop shell draws its own title bar, so drop the duplicate web
  // header there and keep only the controls (tabs, theme, machine, scan).
  const embedded =
    new URLSearchParams(location.search).get("embed") === "1" ||
    Boolean(window.chrome?.webview);
  if (embedded) {
    document.documentElement.classList.add("embedded");
  }

  api("/api/health")
    .then((h) => {
      $("about-version").textContent = `${h.app} v${h.version} · ${h.os}${h.webview ? " · 桌面模式" : ""}`;
    })
    .catch(() => {});

  // Deep link used by the tray menu: /?scan=1 starts a scan immediately.
  const params = new URLSearchParams(location.search);
  if (params.get("scan") === "1" || params.get("autoscan") === "1") {
    setTimeout(scan, 250);
  }

  // Post after first paint too: the WebView2 host is not always listening when
  // the page boots, so a second post guards against a dropped first message.
  setTimeout(() => notifyHost(state.theme), 700);
  setStatus("就绪");
})();
