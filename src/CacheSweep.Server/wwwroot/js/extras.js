"use strict";

/**
 * Plugins, automatic cleanup, autostart and language switching.
 *
 * Kept out of app.js so the main file stays about the cleanup flow. This module
 * exposes a single `initExtras()` entry point that app.js calls on boot.
 */

// i18n.js declares a global `t`; use that instead of destructuring it here,
// which would collide ("Identifier t has already been declared").
const tr = (key) => window.CacheSweepI18n.t(key);

/* ---------------- plugins ---------------- */

const pluginState = {
  items: [],
  busy: false,
};

async function loadPlugins() {
  try {
    const data = await api("/api/plugins");
    pluginState.items = data.plugins;
    renderPlugins();
  } catch (err) {
    showBanner("error", `${tr("plugins.loadFailed")}${err.message}`);
  }
}

function renderPlugins() {
  const host = $("plugins-list");
  host.innerHTML = "";

  const installed = pluginState.items.filter((p) => p.installed).length;
  const note = tr("plugins.count")
    .replace("{n}", installed)
    .replace("{m}", pluginState.items.length);
  $("plugins-note").textContent = note;

  for (const plugin of pluginState.items) {
    const card = document.createElement("div");
    card.className =
      "plugin-card" +
      (plugin.installed ? " is-installed" : "") +
      (plugin.disabled ? " is-disabled" : "");

    const head = document.createElement("div");
    head.className = "plugin-head";

    const icon = document.createElement("div");
    icon.className = "plugin-icon";
    icon.textContent = plugin.icon || "🧩";

    const titles = document.createElement("div");
    titles.innerHTML =
      `<div class="plugin-name">${escapeHtml(plugin.name)}</div>` +
      `<div class="plugin-sub">${plugin.ruleCount} ${tr("plugins.rules")}</div>`;

    head.append(icon, titles);

    const desc = document.createElement("div");
    desc.className = "plugin-desc";
    desc.textContent = plugin.description;

    card.append(head, desc);

    // Show which folders exist here, so the user knows if it is relevant.
    if (plugin.detectedPaths && plugin.detectedPaths.length > 0) {
      const paths = document.createElement("div");
      paths.className = "plugin-paths";
      paths.textContent = plugin.detectedPaths.join("\n");
      paths.title = plugin.detectedPaths.join("\n");
      card.appendChild(paths);
    } else {
      const none = document.createElement("div");
      none.className = "plugin-paths";
      none.textContent = tr("plugins.requiresApp");
      card.appendChild(none);
    }

    const actions = document.createElement("div");
    actions.className = "plugin-actions";

    const state = document.createElement("span");
    state.className = `plugin-state ${plugin.installed && !plugin.disabled ? "on" : "off"}`;
    state.textContent = !plugin.installed
      ? tr("plugins.notInstalled")
      : plugin.disabled
        ? tr("plugins.disabled")
        : tr("plugins.enabled");
    actions.appendChild(state);

    const spacer = document.createElement("span");
    spacer.className = "spacer";
    actions.appendChild(spacer);

    if (!plugin.installed) {
      const install = document.createElement("button");
      install.className = "btn primary sm";
      install.textContent = tr("plugins.install");
      install.addEventListener("click", () => togglePlugin(plugin, "install"));
      actions.appendChild(install);
    } else {
      const enable = document.createElement("button");
      enable.className = "btn ghost sm";
      enable.textContent = plugin.disabled ? tr("plugins.enable") : tr("plugins.disable");
      enable.addEventListener("click", () => togglePlugin(plugin, "enable"));
      actions.appendChild(enable);

      const remove = document.createElement("button");
      remove.className = "btn ghost sm";
      remove.textContent = tr("plugins.uninstall");
      remove.addEventListener("click", () => togglePlugin(plugin, "uninstall"));
      actions.appendChild(remove);
    }

    card.appendChild(actions);
    host.appendChild(card);
  }
}

async function togglePlugin(plugin, action) {
  if (pluginState.busy) return;
  pluginState.busy = true;

  try {
    let path;
    let body;

    if (action === "install") {
      path = "/api/plugins/install";
      body = { id: plugin.id, enabled: true };
    } else if (action === "uninstall") {
      path = "/api/plugins/uninstall";
      body = { id: plugin.id, enabled: false };
    } else {
      path = "/api/plugins/enable";
      body = { id: plugin.id, enabled: plugin.disabled };
    }

    const data = await api(path, { method: "POST", body: JSON.stringify(body) });
    pluginState.items = data.plugins;
    renderPlugins();

    // Rule set changed: existing scan results are stale.
    if (typeof invalidateScan === "function") {
      invalidateScan();
    }
    setStatus(
      action === "install"
        ? `${tr("plugins.installedPrefix")}「${plugin.name}」${tr("plugins.installedPlugin")}`
        : action === "uninstall"
          ? `${tr("plugins.uninstalledPrefix")}「${plugin.name}」`
          : `「${plugin.name}」${plugin.disabled ? tr("plugins.enabled") : tr("plugins.disabled")}`
    );
  } catch (err) {
    showBanner("error", `${tr("plugins.actionFailed")}${err.message}`);
  } finally {
    pluginState.busy = false;
  }
}

/* ---------------- automatic cleanup ---------------- */

async function loadAutoClean() {
  try {
    const settings = await api("/api/autoclean");
    $("auto-toggle").checked = Boolean(settings.enabled);
    $("auto-freq").value = settings.frequency || "weekly";
    $("auto-time").value = settings.timeOfDay || "03:00";
    renderAutoLast(settings);
  } catch (err) {
    showBanner("error", `${tr("auto.loadFailed")}${err.message}`);
  }
}

function renderAutoLast(settings) {
  const el = $("auto-last");
  if (!settings.lastRunUtc) {
    el.textContent = tr("auto.never");
    return;
  }

  const when = new Date(settings.lastRunUtc);
  const freed = formatBytes(settings.lastRunFreedBytes || 0);
  el.textContent = `${tr("auto.lastRun")}: ${when.toLocaleString()} · ${freed}`;
}

async function saveAutoClean() {
  const settings = {
    enabled: $("auto-toggle").checked,
    frequency: $("auto-freq").value,
    timeOfDay: $("auto-time").value || "03:00",
    useRecycleBin: true,
  };

  try {
    const saved = await api("/api/autoclean", {
      method: "POST",
      body: JSON.stringify(settings),
    });
    renderAutoLast(saved);
    setStatus(saved.enabled ? tr("auto.enabledOn") : tr("auto.enabledOff"));
  } catch (err) {
    showBanner("error", `${tr("auto.saveFailed")}${err.message}`);
  }
}

async function runAutoCleanNow() {
  const button = $("btn-auto-run");
  button.disabled = true;
  button.textContent = tr("auto.running");

  try {
    const rec = await api("/api/autoclean/run", { method: "POST" });
    if (rec.skipped) {
      showBanner("warn", `${tr("auto.skipped")}：${rec.reason || tr("auto.noRules")}`);
    } else {
      showBanner(
        "ok",
        `<strong>${tr("auto.done")}</strong>：${tr("clean.freed")} <strong>${formatBytes(rec.freedBytes)}</strong>，` +
          `${rec.deletedFiles.toLocaleString("zh-CN")} ${tr("unit.files")}` +
          (rec.failures ? `，${rec.failures} ${tr("unit.items")} ${tr("clean.failed")}` : "")
      );
    }
    await loadAutoClean();
    if (typeof scan === "function") scan().catch(() => {});
  } catch (err) {
    showBanner("error", `${tr("auto.runFailed")}${err.message}`);
  } finally {
    button.disabled = false;
    button.textContent = tr("auto.runNow");
  }
}

/* ---------------- autostart ---------------- */

async function loadStartup() {
  try {
    const data = await api("/api/startup");
    $("autostart-toggle").checked = Boolean(data.enabled);
    $("autostart-command").textContent = data.command || "";
  } catch {
    // The endpoint is Windows-only; ignore failures elsewhere.
  }
}

async function saveStartup() {
  const enabled = $("autostart-toggle").checked;
  const minimized = $("startmin-toggle").checked;

  try {
    await api("/api/startup", {
      method: "POST",
      body: JSON.stringify({ enabled, startMinimized: minimized, exePath: null }),
    });
    await loadStartup();
    setStatus(enabled ? tr("settings.autostartOk") : tr("settings.autostartOff"));
  } catch (err) {
    $("autostart-toggle").checked = !enabled;
    showBanner("error", `${tr("settings.autostartFail")}：${err.message}`);
  }
}

/* ---------------- version + update check ---------------- */

async function loadVersion() {
  try {
    const data = await api("/api/version");
    const el = $("app-version");
    if (el) el.textContent = data.version ? `v${data.version}` : "未知";
  } catch {
    const el = $("app-version");
    if (el) el.textContent = "未知";
  }
}

async function checkForUpdates() {
  const button = $("btn-check-update");
  const box = $("update-result");

  button.disabled = true;
  button.classList.add("is-busy");
  button.textContent = tr("update.checking");
  box.hidden = true;

  try {
    const r = await api("/api/update/check");

    box.hidden = false;
    box.className = "update-result";

    if (r.status === "update-available") {
      box.classList.add("new");
      box.innerHTML =
        `<strong>${tr("update.newVersion")} ${escapeHtml(r.latestVersion || "")}</strong>（${tr("update.current")} v${escapeHtml(r.currentVersion)}）` +
        (r.releaseUrl ? `<br><a href="${escapeHtml(r.releaseUrl)}" target="_blank" rel="noopener">${tr("update.download")}</a>` : "");
    } else if (r.status === "up-to-date") {
      box.classList.add("ok");
      box.textContent = `${tr("update.upToDate")}（v${r.currentVersion}）`;
    } else if (r.status === "no-release") {
      box.classList.add("muted");
      box.textContent = tr("update.noRelease");
    } else {
      box.classList.add("warn");
      box.textContent = r.message;
    }
  } catch (err) {
    box.hidden = false;
    box.className = "update-result warn";
    box.textContent = `${tr("update.checkFailed")}：${err.message}`;
  } finally {
    button.disabled = false;
    button.classList.remove("is-busy");
    button.textContent = tr("settings.checkUpdate");
  }
}

/* ---------------- language ---------------- */

const LANG_KEY = "cachesweep.lang";

async function setLanguage(lang) {
  const { applyLanguage } = window.CacheSweepI18n;
  applyLanguage(lang);
  $("lang-select").value = lang;

  // Keep the server in sync so the desktop shell and next launch agree.
  api("/api/preferences/language", {
    method: "POST",
    body: JSON.stringify({ theme: lang }),
  }).catch(() => {});

  // Re-render anything that builds strings in JS rather than from markup.
  if (pluginState.items.length > 0) renderPlugins();
  if (typeof drawRules === "function" && state.rules.length > 0) drawRules();
  if (typeof renderApps === "function" && state.apps.length > 0) renderApps();
  if (typeof renderDrives === "function" && state.drives.length > 0) renderDrives(state.drives);
  if (typeof updateButtons === "function") updateButtons();
  if (typeof loadAutoClean === "function") loadAutoClean();

  setStatus(tr("status.ready"));
}

/* ---------------- font settings ---------------- */

const FONT_SIZE_KEY = "cachesweep.fontSize";
const FONT_FAMILY_KEY = "cachesweep.fontFamily";

const FONT_SIZES = { small: "15px", normal: "16px", large: "17.5px" };
const FONT_FAMILIES = {
  system: '"Segoe UI Variable Display", "Segoe UI", system-ui, "Microsoft YaHei", sans-serif',
  yahei: '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif',
  songti: '"SimSun", "宋体", "NSimSun", serif',
  kaiti: '"KaiTi", "楷体", "STKaiti", serif',
};

function applyFontSize(size) {
  const px = FONT_SIZES[size] || FONT_SIZES.normal;
  document.documentElement.style.setProperty("--root-font-size", px);
  try { localStorage.setItem(FONT_SIZE_KEY, size); } catch {}
}

function applyFontFamily(family) {
  const stack = FONT_FAMILIES[family] || FONT_FAMILIES.system;
  document.documentElement.style.setProperty("--font-ui", stack);
  try { localStorage.setItem(FONT_FAMILY_KEY, family); } catch {}
}

function loadFontSettings() {
  let size = "normal";
  let family = "system";
  try {
    const s = localStorage.getItem(FONT_SIZE_KEY);
    if (s && FONT_SIZES[s]) size = s;
    const f = localStorage.getItem(FONT_FAMILY_KEY);
    if (f && FONT_FAMILIES[f]) family = f;
  } catch {}
  applyFontSize(size);
  applyFontFamily(family);
  return { size, family };
}

/* ---------------- init ---------------- */

function initExtras() {
  // Language first: everything rendered below should already be translated.
  const saved = document.documentElement.dataset.lang || "zh";
  window.CacheSweepI18n.applyLanguage(saved);
  $("lang-select").value = saved;

  // Font settings: restore before anything else renders so there is no flash.
  const font = loadFontSettings();
  $("font-size-select").value = font.size;
  $("font-family-select").value = font.family;

  $("font-size-select").addEventListener("change", (e) => applyFontSize(e.target.value));
  $("font-family-select").addEventListener("change", (e) => applyFontFamily(e.target.value));

  $("lang-select").addEventListener("change", (e) => setLanguage(e.target.value));

  $("auto-toggle").addEventListener("change", saveAutoClean);
  $("auto-freq").addEventListener("change", saveAutoClean);
  $("auto-time").addEventListener("change", saveAutoClean);
  $("btn-auto-run").addEventListener("click", runAutoCleanNow);

  $("autostart-toggle").addEventListener("change", saveStartup);
  $("startmin-toggle").addEventListener("change", () => {
    if ($("autostart-toggle").checked) saveStartup();
  });

  // Click-feedback strength. The value is applied live, so the user feels the
  // change while dragging rather than after a save.
  const range = $("feedback-range");
  const valueLabel = $("feedback-value");

  const applyRangeUi = (level) => {
    const labels = [tr("settings.feedbackOff"), tr("settings.feedbackNormal"), tr("settings.feedbackStrong")];
    valueLabel.textContent = labels[level] || labels[1];
    // Fill the track up to the thumb.
    range.style.setProperty("--range-pct", `${(level / 2) * 100}%`);
    window.CacheSweepFeedback.applyFeedbackLevel(level);
  };

  applyRangeUi(window.CacheSweepFeedback.loadFeedbackLevel());

  range.addEventListener("input", () => {
    applyRangeUi(Number(range.value));
  });

  $("tab-plugins").addEventListener("click", () => {
    showView("plugins");
    loadPlugins();
  });

  $("btn-check-update").addEventListener("click", checkForUpdates);

  loadPlugins();
  loadStartup();
  loadAutoClean();
  loadVersion();
}

window.CacheSweepExtras = {
  initExtras,
  loadPlugins,
  loadAutoClean,
  loadStartup,
  setLanguage,
  loadVersion,
  checkForUpdates,
};
