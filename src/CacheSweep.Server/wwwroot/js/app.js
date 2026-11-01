"use strict";

/* CacheSweep browser UI.
 * Talks only to the local API; it never touches the file system itself.
 * The server accepts rule ids, never paths, so a compromised page can only act
 * on targets that already exist in the rule set. */

/* Category and risk labels resolve through the active language, so they must
   be functions rather than a table evaluated once at load time. */
function categoryLabel(cat) {
  return t(`category.${cat}`) || cat;
}

function riskLabel(risk) {
  return t(`risk.${risk}`) || risk;
}

const state = {
  scan: null,
  selected: new Set(),
  busy: false,
  pendingAction: null,
  rules: [],
  theme: "dark",
  /** Drives as last reported by the server, for re-rendering the selector. */
  drives: [],
  /** Currently selected drive (e.g. "D:\\"), or null for "all drives". */
  currentDrive: null,
  /** Drive chosen in the scan dropdown; null = scan all drives. */
  scanDrive: null,
  /** Installed apps for the selected drive, kept so the view can re-render. */
  apps: [],
  /** Installed-app layout: "list" | "grid" | "compact". */
  appView: "list",
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
  for (const v of ["sweep", "disk", "rules", "plugins", "settings", "force"]) {
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
      `<div class="empty"><p>${t("sweep.noCacheTitle")}</p><p class="hint">${t("sweep.noCacheHint")}</p></div>`;
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
    riskBadge.textContent = riskLabel(item.risk);
    title.appendChild(riskBadge);

    const catBadge = document.createElement("span");
    catBadge.className = "badge cat";
    catBadge.textContent = categoryLabel(item.category);
    title.appendChild(catBadge);

    if (item.status === "in-use") {
      const st = document.createElement("span");
      st.className = "badge status-in-use";
      st.textContent = t("status.inUse");
      st.title = t("status.inUseHint");
      title.appendChild(st);
    } else if (item.status === "blocked") {
      const st = document.createElement("span");
      st.className = "badge status-blocked";
      st.textContent = t("status.blocked");
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
    files.textContent = `${item.fileCount.toLocaleString("zh-CN")} ${t("unit.files")}`;
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

  const clean = t("action.clean");
  $("btn-clean").textContent = n === 0 ? clean : `${clean} (${n})`;
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
  setStatus(t("status.scanning"), true);

  try {
    // Respect the drive picked in the scan dropdown; null = scan everything.
    const body = state.scanDrive ? JSON.stringify({ drive: state.scanDrive }) : "{}";
    const data = await api("/api/scan", { method: "POST", body });
    state.scan = data;
    renderSummary(data);
    renderList();

    const active = data.items.filter((i) => i.status !== "missing" && i.bytes > 0);
    const inUse = data.items.filter((i) => i.status === "in-use").length;
    const ignored = data.items.filter((i) => i.status === "ignored").length;

    showBanner(
      data.totals.bytes > 0 ? "info" : "ok",
      data.totals.bytes > 0
        ? `${t("scan.doneActive")}<strong>${active.length}</strong>${t("scan.doneActive2")}<strong>${formatBytes(
            data.totals.bytes
          )}</strong>${t("scan.doneActive3")}${(data.scanDurationMs / 1000).toFixed(2)}${t("unit.s")}。` +
            (inUse ? ` ${t("scan.inUse")}${inUse}${t("scan.inUse2")}` : "") +
            (ignored ? ` ${ignored} ${t("scan.ignored")}` : "") +
            ` ${t("scan.hint")}`
        : t("scan.empty")
    );
    setStatus(t("status.ready"));
  } catch (err) {
    showBanner("error", `${t("scan.failed")}${err.message}`);
    setStatus(t("status.scanFailed"));
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

  const more = chosen.length > 14 ? `<li class="muted">…${t("modal.andOthers")} ${chosen.length - 14} ${t("unit.items")}</li>` : "";

  const body = `
    <p>${t("modal.willProcess")} <strong>${chosen.length}</strong> ${t("modal.targets")}，${t("modal.estimate")} <strong>${formatBytes(reclaim)}</strong>。</p>
    <ul>${items}${more}</ul>
    ${
      dangerous.length
        ? `<p style="color:var(--danger)">⚠ ${t("modal.containsDangerous")}：${dangerous
            .map((d) => d.name)
            .join("、")}。${t("modal.dangerousConfirm")}</p>`
        : ""
    }
    <p class="muted">${recycle ? t("modal.willRecycle") : t("modal.willDelete")}</p>
    <p class="muted">${dryRun ? t("modal.previewNote") : t("modal.realNote")}</p>
  `;

  $("modal-ok").className = dryRun ? "btn primary" : "btn danger";
  openModal(
    dryRun ? t("modal.previewTitle") : t("modal.confirmTitle"),
    body,
    async () => {
      closeModal();
      await runClean(ids, dryRun);
    },
    dryRun ? t("modal.generatePreview") : t("action.confirm")
  );
}

/* ---------------- clean progress panel ---------------- */

/** Resets the panel to its starting state and shows it. */
function openProgress(dryRun) {
  const box = document.querySelector("#progress-modal .progress-box");
  box.classList.remove("is-done");
  $("progress-title").textContent = dryRun ? t("progress.title.preview") : t("progress.title.clean");
  $("progress-current-name").textContent = t("progress.preparing");
  $("progress-percent").textContent = "0%";
  $("progress-count").textContent = "0 / 0";
  $("progress-freed").textContent = "0 B";
  $("progress-files").textContent = "0";
  $("progress-failures").textContent = "0";
  $("progress-log").innerHTML = "";
  $("progress-fill").style.width = "0%";
  $("progress-track").setAttribute("aria-valuenow", "0");
  $("progress-close").hidden = true;
  $("progress-modal").hidden = false;
}

function closeProgress() {
  $("progress-modal").hidden = true;
}

/** Applies one progress event to the panel. */
function updateProgress(evt) {
  const percent = Math.max(0, Math.min(100, Number(evt.percent) || 0));

  $("progress-fill").style.width = `${percent}%`;
  $("progress-track").setAttribute("aria-valuenow", String(percent));
  $("progress-percent").textContent = `${percent}%`;
  $("progress-count").textContent = `${evt.index || 0} / ${evt.total || 0}`;
  $("progress-freed").textContent = formatBytes(evt.freedBytes || 0);
  $("progress-files").textContent = (evt.deletedFiles || 0).toLocaleString("zh-CN");
  $("progress-failures").textContent = String(evt.failures || 0);

  if (evt.currentName) {
    $("progress-current-name").textContent = evt.currentName;
  }

  // Append one line per finished target so the user sees concrete activity.
  if (evt.currentName) {
    const line = document.createElement("div");
    line.className = "progress-log-line";

    const mark = document.createElement("span");
    mark.className = evt.currentSuccess ? "tick" : "cross";
    mark.textContent = evt.currentSuccess ? "✓" : "✗";

    const name = document.createElement("span");
    name.textContent = evt.currentName;

    const amount = document.createElement("span");
    amount.className = "amount";
    amount.textContent = evt.currentSuccess
      ? `${t("status.success")}，${t("progress.freed")} ${formatBytes(evt.currentBytes || 0)}`
      : `${t("status.failed")}：${evt.currentError || t("status.failed")}`;

    line.append(mark, name, amount);
    const log = $("progress-log");
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }
}

/** Called once the run finished: freezes the bar and offers a close button. */
function finishProgress(evt, dryRun) {
  const box = document.querySelector("#progress-modal .progress-box");
  box.classList.add("is-done");

  $("progress-fill").style.width = "100%";
  $("progress-track").setAttribute("aria-valuenow", "100");
  $("progress-percent").textContent = "100%";
  $("progress-title").textContent = dryRun ? t("progress.title.previewDone") : t("progress.title.done");

  const secs = ((evt.durationMs || 0) / 1000).toFixed(2);
  $("progress-current-name").textContent = dryRun
    ? `${t("progress.reclaimable")} ${formatBytes(evt.freedBytes || 0)}，${t("progress.elapsed")} ${secs}${t("unit.s")}`
    : `${t("progress.freed")} ${formatBytes(evt.freedBytes || 0)}，${t("progress.elapsed")} ${secs}${t("unit.s")}`;

  $("progress-close").hidden = false;
  $("progress-close").focus();
}

/**
 * Posts to the streaming clean endpoint and drives the progress panel.
 * Returns the final result payload (same shape as /api/clean).
 */
async function cleanWithProgress(ids, dryRun) {
  const res = await fetch("/api/clean/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetIds: ids,
      dryRun,
      useRecycleBin: $("use-recycle").checked,
      allowDangerous: true, // the confirm modal already demanded explicit consent
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try {
      message = JSON.parse(text)?.error || message;
    } catch {
      message = text || message;
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final = null;

  // Parse the SSE stream: events are separated by a blank line, payload on
  // `data:` lines.
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;

        let evt;
        try {
          evt = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }

        if (evt.kind === "done") {
          final = evt;
          finishProgress(evt, dryRun);
        } else {
          updateProgress(evt);
        }
      }
    }
  }

  if (!final) {
    throw new Error("清理过程意外中断");
  }

  return final.result;
}

async function runClean(ids, dryRun) {
  state.busy = true;
  updateButtons();
  setStatus(dryRun ? t("status.previewing") : t("status.cleaning"), true);
  openProgress(dryRun);

  try {
    const result = await cleanWithProgress(ids, dryRun);

    const failed = result.items.filter((i) => !i.success);
    const lines = result.items
      .map(
        (i) =>
          `<li>${i.success ? "✓" : "✗"} ${i.name} — ` +
          (i.success
            ? `${t("status.success")}，${t("progress.freed")} ${formatBytes(i.freedBytes)}`
            : `${t("status.failed")}：${i.error || t("status.failed")}`) +
          `</li>`
      )
      .join("");

    showBanner(
      dryRun ? "info" : failed.length ? "warn" : "ok",
      `<strong>${dryRun ? t("clean.previewResult") : t("clean.done")}</strong>：` +
        `${dryRun ? t("clean.reclaimable") : t("clean.freed")} <strong>${formatBytes(result.totalFreedBytes)}</strong>，` +
        `${t("clean.involving")} ${result.totalDeletedFiles.toLocaleString("zh-CN")} ${t("unit.files")}，` +
        `${t("clean.elapsed")} ${(result.durationMs / 1000).toFixed(2)}${t("unit.s")}。` +
        (failed.length ? ` ${t("clean.failed")} ${failed.length} ${t("unit.items")}。` : "") +
        `<ul>${lines}</ul>` +
        (dryRun ? `<p>${t("clean.confirmHint")}</p>` : "")
    );

    if (!dryRun) {
      // Rescan in the background so the freed space shows up right away; the
      // progress panel stays up until the user dismisses it.
      state.busy = false;
      scan().catch(() => {});
      return;
    }
    setStatus(t("status.previewDone"));
  } catch (err) {
    closeProgress();
    showBanner("error", `${t("clean.failed")}：${err.message}`);
    setStatus(t("status.cleanFailed"));
  } finally {
    state.busy = false;
    updateButtons();
  }
}

/* ---------------- disk usage ---------------- */

/**
 * Renders one selectable card per volume. Clicking a card scopes the three
 * panels below (installed apps, large files, folder usage) to that drive, so
 * every disk can be inspected on its own.
 */
function renderDrives(drives) {
  const wrap = $("drives");
  wrap.innerHTML = "";

  for (const d of drives) {
    const pct = d.totalBytes ? (d.usedBytes / d.totalBytes) * 100 : 0;
    const level = pct >= 92 ? "crit" : pct >= 80 ? "warn" : "";
    const active = state.currentDrive === d.name;

    const card = document.createElement("button");
    card.type = "button";
    card.className = `drive-card${active ? " is-active" : ""}`;
    card.setAttribute("aria-pressed", String(active));
    card.innerHTML = `
      <div class="drive-card-top">
        <span class="drive-card-name">${escapeHtml(d.name)}</span>
        <span class="drive-card-pct">${pct.toFixed(0)}%</span>
      </div>
      <div class="drive-card-label">${escapeHtml(d.label || d.format || t("disk.localDisk"))}</div>
      <div class="drive-card-bar ${level}"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="drive-card-meta">
        <span>${t("disk.used")} ${formatBytes(d.usedBytes)}</span>
        <span>${t("disk.total")} ${formatBytes(d.totalBytes)}</span>
      </div>
      <div class="drive-card-meta">
        <span>${t("disk.free")} ${formatBytes(d.freeBytes)}</span>
      </div>`;

    card.addEventListener("click", () => selectDrive(d.name));
    wrap.appendChild(card);
  }

  // "All drives" reset card, only useful when more than one volume exists.
  if (drives.length > 1) {
    const all = document.createElement("button");
    all.type = "button";
    all.className = `drive-card${state.currentDrive === null ? " is-active" : ""}`;
    all.setAttribute("aria-pressed", String(state.currentDrive === null));
    all.innerHTML = `
      <div class="drive-card-top">
        <span class="drive-card-name">${t("disk.all")}</span>
      </div>
      <div class="drive-card-label">${t("disk.unrestricted")}</div>
      <div class="drive-card-bar"><span style="width:0%"></span></div>
      <div class="drive-card-meta">
        <span>${drives.length} ${t("disk.drives")}</span>
      </div>`;
    all.addEventListener("click", () => selectDrive(null));
    wrap.appendChild(all);
  }
}

/** Switches the analysis scope and reloads whatever has already been shown. */
function selectDrive(drive) {
  state.currentDrive = drive;
  state.inventoryLoaded.apps = false;
  state.inventoryLoaded.files = false;
  state.inventoryLoaded.folders = false;

  const label = drive ? `${drive}` : t("disk.all");
  $("apps-drive-label").textContent = label;
  $("files-drive-label").textContent = label;
  $("folders-drive-label").textContent = label;

  renderDrives(state.drives);

  // Reset the panel numbers so stale figures from another drive are not shown.
  $("apps-total").textContent = "—";
  $("files-total").textContent = "—";
  $("folders-total").textContent = "—";
  $("apps-note").textContent = "—";
  $("files-note").textContent = "—";
  $("folders-note").textContent = "—";
  $("apps-list").innerHTML = "";
  $("files-list").innerHTML = "";
  $("folders-list").innerHTML = "";

  loadApps(true);
  loadLargeFiles();
  loadFolders();
}

async function loadDrives() {
  try {
    const drives = await api("/api/inventory/drives");
    state.drives = drives;
    state.inventoryLoaded.drives = true;

    // Default to the first fixed volume so the panels are populated on entry.
    const initial = state.currentDrive ?? (drives.length > 0 ? drives[0].name : null);
    selectDrive(initial);
  } catch (err) {
    showBanner("error", `${t("disk.loadFailed")}${err.message}`);
  }
}

/** Re-reads volumes (a USB stick may have been plugged in). */
async function refreshDrives() {
  state.inventoryLoaded.drives = false;
  state.currentDrive = null;
  await loadDrives();
}

function renderInventoryRows(container, rows) {
  container.innerHTML = "";
  if (rows.length === 0) {
    container.innerHTML = `<div class="empty" style="padding:32px"><p>${t("disk.noData")}</p></div>`;
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
  setStatus(t("status.loadingApps"), true);
  $("apps-note").textContent = t("status.loadingAppsDetail");
  $("apps-list").innerHTML = "";

  try {
    const drive = state.currentDrive;
    const qs = drive ? `?drive=${encodeURIComponent(drive)}` : "";
    const data = await api(`/api/inventory/apps${qs}`);
    $("apps-total").textContent = formatBytes(data.totalBytes);
    $("apps-note").textContent = `${data.count} ${t("unit.apps")}，${t("clean.elapsed")} ${(data.durationMs / 1000).toFixed(1)}${t("unit.s")}`;

    state.apps = data.apps;
    renderApps();
    state.inventoryLoaded.apps = true;
    setStatus(t("status.ready"));
  } catch (err) {
    $("apps-note").textContent = `${t("scan.failed")}${err.message}`;
    setStatus(t("status.scanFailed"));
  } finally {
    state.busy = false;
  }
}

/** Builds the icon element: real icon when the server found one, else a tile. */
function appIconEl(app, className) {
  if (app.iconPng) {
    const img = document.createElement("img");
    img.className = className || "app-icon";
    img.src = `data:image/png;base64,${app.iconPng}`;
    img.alt = "";
    img.loading = "lazy";
    return img;
  }

  // Letter tile keeps the row aligned when no icon could be extracted.
  const tile = document.createElement("div");
  tile.className = "app-icon-letter";
  tile.textContent = (app.name || "?").trim().charAt(0);
  return tile;
}

/**
 * Renders the installed-app list in the current view mode.
 * Layouts share the same data; only density and emphasis change.
 */
function renderApps() {
  const host = $("apps-list");
  const apps = state.apps || [];

  host.className = `apps-${state.appView}-view`;
  host.innerHTML = "";

  if (apps.length === 0) {
    host.className = "";
    host.innerHTML = `<div class="empty" style="padding:32px"><p>${t("disk.noData")}</p></div>`;
    return;
  }

  const maxBytes = Math.max(...apps.map((a) => a.bytes), 1);

  if (state.appView === "grid") {
    // The host already carries .apps-grid-view, so cards go straight into it.
    const grid = host;
    for (const app of apps) {
      const card = document.createElement("div");
      card.className = "app-card";

      const name = document.createElement("div");
      name.className = "app-name";
      name.textContent = app.name;
      name.title = app.installLocation;

      const size = document.createElement("div");
      size.className = "app-size";
      size.textContent = formatBytes(app.bytes);

      card.append(appIconEl(app), name, size);
      grid.appendChild(card);
    }
    return;
  }

  if (state.appView === "compact") {
    const wrap = host;
    for (const app of apps) {
      const line = document.createElement("div");
      line.className = "app-line";
      line.title = app.installLocation;

      const name = document.createElement("div");
      name.className = "app-name";
      name.textContent = app.name;

      const size = document.createElement("div");
      size.className = "app-size";
      size.textContent = formatBytes(app.bytes);

      line.append(appIconEl(app), name, size);
      wrap.appendChild(line);
    }
    return;
  }

  // Default: list rows with a proportional bar.
  const wrap = host;

  for (const app of apps) {
    const row = document.createElement("div");
    row.className = "app-row";

    const main = document.createElement("div");
    main.className = "app-main";

    const name = document.createElement("div");
    name.className = "app-name";
    name.textContent = app.name;

    const sub = document.createElement("div");
    sub.className = "app-sub";
    sub.textContent = app.installLocation + (app.locationMissing ? `  (${t("disk.locationMissing")})` : "");
    sub.title = app.installLocation;

    const bar = document.createElement("div");
    bar.className = "app-bar";
    const fill = document.createElement("span");
    fill.style.width = `${((app.bytes / maxBytes) * 100).toFixed(1)}%`;
    bar.appendChild(fill);

    main.append(name, sub, bar);

    const size = document.createElement("div");
    size.className = "app-size";
    size.textContent = formatBytes(app.bytes);
    const files = document.createElement("small");
    files.textContent = `${(app.fileCount || 0).toLocaleString("zh-CN")} ${t("unit.files")}`;
    size.appendChild(files);

    row.append(appIconEl(app), main, size);
    wrap.appendChild(row);
  }
}

async function loadLargeFiles() {
  if (state.busy) return;
  state.busy = true;
  setStatus(t("status.findingLargeFiles"), true);

  // Large files only make sense per volume; fall back to the first drive when
  // "all drives" is selected.
  const drive = state.currentDrive || (state.drives[0]?.name ?? "C:\\");
  $("files-note").textContent = `${t("disk.scanning")} ${drive} …`;
  $("files-list").innerHTML = "";

  const minMb = Number($("file-min").value) || 100;

  try {
    const data = await api(
      `/api/inventory/large-files?root=${encodeURIComponent(drive)}&minMb=${minMb}&take=50`
    );
    $("files-total").textContent = formatBytes(data.totalBytes);
    $("files-note").textContent = `${t("disk.found")} ${data.count} ${t("disk.foundFiles")} ≥${minMb}MB`;

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
    setStatus(t("status.ready"));
  } catch (err) {
    $("files-note").textContent = `${t("scan.failed")}${err.message}`;
    setStatus(t("status.scanFailed"));
  } finally {
    state.busy = false;
  }
}

async function loadFolders() {
  if (state.busy) return;
  state.busy = true;
  setStatus(t("status.measuringFolders"), true);

  const drive = state.currentDrive || (state.drives[0]?.name ?? "C:\\");
  $("folders-note").textContent = `${t("disk.scanning")} ${drive} …`;
  $("folders-list").innerHTML = "";

  try {
    const data = await api(`/api/inventory/folders?drive=${encodeURIComponent(drive)}`);
    const total = data.folders.reduce((s, f) => s + f.bytes, 0);
    $("folders-total").textContent = formatBytes(total);
    $("folders-note").textContent = `${data.folders.length} ${t("unit.dirs")}`;

    renderInventoryRows(
      $("folders-list"),
      data.folders.map((f) => ({
        title: f.name,
        sub: f.path,
        bytes: f.bytes,
        detail: `${f.fileCount.toLocaleString("zh-CN")} ${t("unit.files")}`,
      }))
    );
    state.inventoryLoaded.folders = true;
    setStatus(t("status.ready"));
  } catch (err) {
    $("folders-note").textContent = `${t("scan.failed")}${err.message}`;
    setStatus(t("status.scanFailed"));
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
        `${t("rules.rejectedPrefix")} ${data.rejected.length} ${t("rules.rejectedSuffix")}：` +
          data.rejected.map((r) => `<code>${escapeHtml(r.id)}</code> — ${escapeHtml(r.reason)}`).join("；")
      );
    }
  } catch (err) {
    showBanner("error", `${t("rules.loadFailed")}${err.message}`);
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
    setStatus(`「${rule.name}」${enabled ? t("rules.movedToWhite") : t("rules.movedToBlack")}`);
  } catch (err) {
    showBanner("error", `${t("rules.changeFailed")}${err.message}`);
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
  $("empty").querySelector("p").textContent = t("rules.rescanHint");
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
    setStatus(`${ids.length} ${t("unit.rules")}${enabled ? t("rules.movedToWhite") : t("rules.movedToBlack")}`);
  } catch (err) {
    showBanner("error", `${t("rules.changeFailed")}${err.message}`);
  }
}
async function addCustomRule() {
  const path = $("custom-path").value.trim();
  if (!path) {
    showBanner("warn", t("rules.pathRequired"));
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
    showBanner("ok", t("rules.customAdded"));
    await loadRules();
  } catch (err) {
    showBanner("error", `${t("rules.addFailed")}${escapeHtml(err.message)}`);
  }
}

async function removeCustomRule(rule) {
  if (!confirm(t("rules.deleteConfirmPrefix") + rule.name + t("rules.deleteConfirmSuffix"))) return;

  try {
    await api(`/api/targets/custom/${encodeURIComponent(rule.id)}`, { method: "DELETE" });
    showBanner("ok", t("rules.deleted"));
    await loadRules();
  } catch (err) {
    showBanner("error", `${t("rules.deleteFailed")}${err.message}`);
  }
}

/* ---------------- settings ---------------- */

async function showAudit() {
  try {
    const lines = await api("/api/audit");
    openModal(
      t("settings.viewAudit"),
      `<pre style="max-height:46vh;overflow:auto;font-family:var(--font-mono);font-size:11.5px;line-height:1.7;white-space:pre-wrap">${lines
        .slice(-60)
        .map(escapeHtml)
        .join("\n")}</pre>`,
      closeModal,
      t("action.done")
    );
    $("modal-ok").className = "btn primary";
  } catch (err) {
    showBanner("error", `${t("audit.loadFailed")}${err.message}`);
  }
}

/* ---------------- modal ---------------- */

function openModal(title, bodyHtml, onConfirm, okLabel) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = bodyHtml;
  $("modal-ok").textContent = okLabel || t("action.confirm");
  $("confirm-modal").hidden = false;
  state.pendingAction = onConfirm;
}

function closeModal() {
  $("confirm-modal").hidden = true;
  state.pendingAction = null;
}

/* ---------------- wiring ---------------- */

$("btn-scan").addEventListener("click", scan);
$("btn-big-scan").addEventListener("click", scan);
$("btn-preview").addEventListener("click", () => requestClean(true));
$("btn-clean").addEventListener("click", () => requestClean(false));

/* Scan-drive dropdown: pick which volume to scan. */
$("btn-scan-drive").addEventListener("click", async (e) => {
  e.stopPropagation();
  await openScanDriveMenu();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".scan-combo")) {
    $("scan-drive-menu").hidden = true;
  }
});

async function openScanDriveMenu() {
  const menu = $("scan-drive-menu");
  if (!menu.hidden) {
    menu.hidden = true;
    return;
  }

  // Load drives on first open, or reuse what the analysis view already has.
  let drives = state.drives;
  if (!drives.length) {
    try {
      drives = await api("/api/inventory/drives");
      state.drives = drives;
    } catch {
      drives = [];
    }
  }

  menu.innerHTML = "";

  // "All drives" option.
  const all = document.createElement("button");
  all.type = "button";
  all.innerHTML = `<span>${t("disk.all")}</span><span class="drv-meta">${t("disk.unrestricted")}</span>`;
  all.classList.toggle("is-active", state.scanDrive === null);
  all.addEventListener("click", () => {
    state.scanDrive = null;
    menu.hidden = true;
    scan();
  });
  menu.appendChild(all);

  for (const d of drives) {
    const b = document.createElement("button");
    b.type = "button";
    const meta = `${formatBytes(d.usedBytes)} / ${formatBytes(d.totalBytes)}`;
    b.innerHTML = `<span>${escapeHtml(d.name)} ${escapeHtml(d.label || "")}</span><span class="drv-meta">${meta}</span>`;
    b.classList.toggle("is-active", state.scanDrive === d.name);
    b.addEventListener("click", () => {
      state.scanDrive = d.name;
      menu.hidden = true;
      scan();
    });
    menu.appendChild(b);
  }

  menu.hidden = false;
}

$("tab-sweep").addEventListener("click", () => showView("sweep"));
$("tab-disk").addEventListener("click", () => showView("disk"));
$("tab-rules").addEventListener("click", () => showView("rules"));
$("tab-settings").addEventListener("click", () => showView("settings"));
$("tab-force").addEventListener("click", () => {
  showView("force");
  if (!forceApps.length) loadForceApps();
});

/* ---------------- brute-force removal ---------------- */

let forceApps = [];
let forceView = "list";
const forceSelected = new Set();

$("force-refresh").addEventListener("click", loadForceApps);
$("btn-force-delete").addEventListener("click", startForceDeleteSelected);
$("btn-force-delete-path").addEventListener("click", () => {
  const path = ($("force-path").value || "").trim();
  if (!path) { showBanner("warn", t("force.needPath")); return; }
  confirmForceDelete([path]);
});

document.querySelectorAll("#force-view-switch button").forEach((b) => {
  b.addEventListener("click", () => {
    forceView = b.dataset.view;
    document.querySelectorAll("#force-view-switch button").forEach((x) => x.classList.toggle("active", x === b));
    renderForceApps();
  });
});

$("force-select-all").addEventListener("change", (e) => {
  if (e.target.checked) forceApps.forEach((a) => forceSelected.add(a.installLocation));
  else forceSelected.clear();
  renderForceApps();
});

async function loadForceApps() {
  $("force-list").innerHTML = "";
  try {
    const data = await api("/api/inventory/apps");
    forceApps = (data.apps || []).filter((a) => a.installLocation);
    forceSelected.clear();
    renderForceApps();
  } catch (err) {
    showBanner("error", `${t("force.failed")}：${err.message}`);
  }
}

function renderForceApps() {
  const host = $("force-list");
  const apps = forceApps || [];
  host.className = `apps-${forceView}-view`;
  host.innerHTML = "";
  $("force-empty").hidden = apps.length > 0;
  $("force-toolbar").hidden = apps.length === 0;
  updateForceSelectionUi();

  for (const app of apps) {
    const el = document.createElement("label");
    el.className = forceView === "grid" ? "app-card force-item" : forceView === "compact" ? "app-line force-item" : "app-row force-item";
    el.title = app.installLocation;

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "force-chk";
    chk.checked = forceSelected.has(app.installLocation);
    chk.addEventListener("change", () => {
      if (chk.checked) forceSelected.add(app.installLocation);
      else forceSelected.delete(app.installLocation);
      updateForceSelectionUi();
    });

    const name = document.createElement("div");
    name.className = "app-name";
    name.textContent = app.name;

    if (forceView === "list") {
      const main = document.createElement("div");
      main.className = "app-main";
      const sub = document.createElement("div");
      sub.className = "app-sub";
      sub.textContent = app.installLocation;
      sub.title = app.installLocation;
      main.append(name, sub);
      const size = document.createElement("div");
      size.className = "app-size";
      size.textContent = formatBytes(app.bytes);
      el.append(chk, appIconEl(app), main, size);
    } else {
      const size = document.createElement("div");
      size.className = "app-size";
      size.textContent = formatBytes(app.bytes);
      el.append(chk, appIconEl(app), name, size);
    }

    host.appendChild(el);
  }
}

function updateForceSelectionUi() {
  const n = forceSelected.size;
  $("force-selected-count").textContent = `已选 ${n} ${t("unit.items")}`;
  $("btn-force-delete").disabled = n === 0;
  $("btn-force-delete").textContent = n === 0 ? t("force.btn") : `${t("force.btn")} (${n})`;
  $("force-select-all").checked = forceApps.length > 0 && n === forceApps.length;
}

function startForceDeleteSelected() {
  const paths = [...forceSelected];
  if (!paths.length) { showBanner("warn", t("force.needPath")); return; }
  confirmForceDelete(paths);
}

function confirmForceDelete(paths) {
  const count = paths.length;
  const listHtml = paths.map((p) => `<li style="margin:2px 0">${escapeHtml(p)}</li>`).join("");

  // Step 1: warning.
  openModal(
    t("force.warning"),
    `<p>${t("force.warnBody1")}（${count} ${t("unit.items")}）</p>` +
      `<ul style="max-height:130px;overflow:auto;font-size:0.8125rem">${listHtml}</ul>` +
      `<p style="color:var(--danger)">${t("force.warnBody2")}</p>`,
    () => {
      // Step 2: type "yes" to proceed, or "no" to cancel.
      openModal(
        t("force.typeConfirm"),
        `<p>${t("force.typeConfirmBody")}</p>` +
          `<input id="force-type-input" type="text" class="field" style="width:100%" placeholder="yes / no" />`,
        () => {
          const typed = (($("force-type-input")?.value) || "").trim().toLowerCase();
          if (typed !== "yes") {
            showBanner("error", t("force.confirmMismatch"));
            return;
          }
          openModal(
            t("force.finalConfirm"),
            `<p style="color:var(--danger);font-weight:800">${t("force.finalBody")}</p>`,
            () => doForceDeleteMany(paths),
            t("force.doDelete")
          );
        },
        t("action.continue")
      );
    },
    t("action.continue")
  );
}

async function doForceDeleteMany(paths) {
  $("force-result").textContent = "";
  $("btn-force-delete").disabled = true;

  // Pop the centred deletion animation.
  const overlay = $("force-delete-overlay");
  const logEl = $("force-dialog-log");
  const fill = $("force-dialog-fill");
  const sub = $("force-dialog-sub");
  logEl.innerHTML = "";
  fill.style.width = "0%";
  sub.textContent = `0 / ${paths.length}`;
  overlay.hidden = false;
  // Give the popup a frame to paint before deletion starts, so it never looks frozen.
  await new Promise((r) => requestAnimationFrame(() => r()));

  // Map each installLocation back to its list row so it shakes in place too.
  const itemByPath = new Map();
  document.querySelectorAll("#force-list .force-item").forEach((el) => itemByPath.set(el.title, el));

  let done = 0;
  let failed = 0;
  const total = paths.length;

  for (const path of paths) {
    const name = path.split(/[\\/]+/).filter(Boolean).pop() || path;
    const el = itemByPath.get(path);
    if (el) {
      el.classList.remove("force-deleted", "force-failed");
      el.classList.add("force-deleting");
    }

    // Show a log line as soon as this item starts.
    const li = document.createElement("li");
    li.textContent = `⏳ ${name}`;
    li.style.color = "var(--text-dim)";
    logEl.appendChild(li);
    logEl.scrollTop = logEl.scrollHeight;

    try {
      const res = await fetch("/api/force/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      // A folder only counts as deleted when it is actually gone from disk.
      const trulyDeleted = res.ok && !data.remains && (data.failedFiles || 0) === 0;
      if (!trulyDeleted) {
        failed++;
        const reason = !res.ok
          ? (data?.error || `HTTP ${res.status}`)
          : data.remains
            ? `仍有 ${data.failedFiles || 0} 个文件未删除（可能被占用或需要权限）`
            : `部分失败`;
        li.textContent = `✗ ${name}：${reason}`;
        li.style.color = "var(--danger)";
        if (el) { el.classList.remove("force-deleting"); el.classList.add("force-failed"); }
      } else {
        done++;
        li.textContent = `✓ ${name}`;
        li.style.color = "var(--safe)";
        if (el) { el.classList.remove("force-deleting"); el.classList.add("force-deleted"); }
      }
    } catch (err) {
      failed++;
      li.textContent = `✗ ${name}：${err.message}`;
      li.style.color = "var(--danger)";
      if (el) { el.classList.remove("force-deleting"); el.classList.add("force-failed"); }
    }

    const finished = done + failed;
    sub.textContent = `${finished} / ${total}`;
    fill.style.width = `${(finished / total) * 100}%`;
    logEl.scrollTop = logEl.scrollHeight;

    // Slight pause so the animation is legible.
    await new Promise((r) => setTimeout(r, 160));
  }

  // Hold the finished popup briefly so the user sees the outcome, then close.
  await new Promise((r) => setTimeout(r, 500));
  overlay.hidden = true;

  showBanner(
    failed ? "warn" : "ok",
    `${t("force.done")}：${done} ${t("unit.items")}${failed ? `，${t("force.failed")} ${failed} ${t("unit.items")}` : ""}`
  );
  await loadForceApps();
}

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

// The progress panel stays up after the run so the user can read the summary;
// this dismisses it. Escape does the same, but only once the run has finished.
$("progress-close").addEventListener("click", closeProgress);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("progress-modal").hidden && !$("progress-close").hidden) {
    closeProgress();
  }
});
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
$("btn-refresh-drives").addEventListener("click", refreshDrives);

// Installed-app layouts. The choice is remembered for the session.
document.querySelectorAll("#apps-view-switch button").forEach((b) => {
  b.addEventListener("click", () => {
    state.appView = b.dataset.view;
    document.querySelectorAll("#apps-view-switch button").forEach((x) => {
      x.classList.toggle("active", x === b);
    });
    renderApps();
  });
});

$("btn-white-all").addEventListener("click", () => moveAllRules(true));
$("btn-black-caution").addEventListener("click", () =>
  moveAllRules(false, (r) => r.risk === "Caution" && r.enabled)
);
$("btn-black-all").addEventListener("click", () => {
  if (!confirm(t("rules.allBlackConfirm"))) return;
  moveAllRules(false);
});
$("btn-add-custom").addEventListener("click", addCustomRule);
$("btn-show-audit").addEventListener("click", showAudit);

/* ---------------- boot ---------------- */

(function boot() {
  const stored = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(stored, false);

  /* The header is pinned; the sticky toolbar below it needs to know its height.
     Measured rather than hard-coded so a wrapped header (narrow window, long
     machine name) still lines up. */
  const topbar = document.querySelector(".topbar");
  if (topbar) {
    const syncHeaderHeight = () => {
      const h = Math.round(topbar.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--topbar-h", `${h}px`);
    };
    syncHeaderHeight();
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(syncHeaderHeight).observe(topbar);
    }
    window.addEventListener("resize", syncHeaderHeight);
  }

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
      $("about-version").textContent = `${h.app} v${h.version} · ${h.os}${h.webview ? ` · ${t("health.desktopMode")}` : ""}`;
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
  setStatus(t("status.ready"));
})();
