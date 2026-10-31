/**
 * Rule management: one row per cleanup rule with an explicit whitelist /
 * blacklist choice on the right.
 *
 *   whitelist = the rule may be cleaned (and is measured on every scan)
 *   blacklist = CacheSweep leaves it alone (not measured, never cleaned)
 *
 * Everything defaults to whitelist; only an explicit click moves a rule to
 * blacklist.
 */

const RULE_CATEGORY_LABEL = {
  TempFiles: "临时文件",
  BrowserCache: "浏览器缓存",
  AppCache: "应用缓存",
  SystemCache: "系统缓存",
  DeveloperCache: "开发者缓存",
  CrashAndDiagnostics: "崩溃与诊断",
  RecycleBin: "回收站",
};

const RULE_RISK_LABEL = { Safe: "安全", Caution: "需确认", Dangerous: "高风险" };

function ruleEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Builds one rule row with its 白名单 / 黑名单 segmented control. */
function buildRuleRow(rule, onChange) {
  const row = document.createElement("div");
  row.className = `rule-row${rule.enabled ? "" : " is-blacklisted"}`;
  row.dataset.risk = rule.risk;

  const main = document.createElement("div");
  main.className = "rule-main";

  const title = document.createElement("div");
  title.className = "row-title";
  title.innerHTML =
    `<span class="rule-name">${ruleEscape(rule.name)}</span>` +
    `<span class="badge ${rule.risk}">${RULE_RISK_LABEL[rule.risk] || rule.risk}</span>` +
    (rule.isCustom ? '<span class="badge cat">自定义</span>' : "");

  const path = document.createElement("div");
  path.className = "row-path";
  path.textContent = rule.path;
  path.title = rule.path;

  const desc = document.createElement("div");
  desc.className = "row-desc";
  desc.textContent = rule.description;

  main.append(title, path, desc);

  const side = document.createElement("div");
  side.className = "rule-side";

  const group = document.createElement("div");
  group.className = "seg";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", `${rule.name} 归类`);

  const white = document.createElement("button");
  white.type = "button";
  white.className = `seg-btn seg-white${rule.enabled ? " active" : ""}`;
  white.textContent = "白名单";
  white.title = "白名单：允许被主动清理";
  white.setAttribute("aria-pressed", String(rule.enabled));

  const black = document.createElement("button");
  black.type = "button";
  black.className = `seg-btn seg-black${rule.enabled ? "" : " active"}`;
  black.textContent = "黑名单";
  black.title = "黑名单：不主动清理，扫描时跳过";
  black.setAttribute("aria-pressed", String(!rule.enabled));

  const choose = async (enabled) => {
    if (rule.enabled === enabled) return;
    group.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await onChange(rule, enabled);
    } finally {
      group.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  };

  white.addEventListener("click", () => choose(true));
  black.addEventListener("click", () => choose(false));

  group.append(white, black);
  side.appendChild(group);

  if (rule.isCustom) {
    const del = document.createElement("button");
    del.className = "icon-btn";
    del.title = "删除这条自定义规则（不会删除任何文件）";
    del.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';
    del.addEventListener("click", () => rule._onDelete?.(rule));
    side.appendChild(del);
  }

  row.append(main, side);
  return row;
}

/** Renders every rule grouped by category. */
function renderRuleList(container, rules, onChange, onDelete) {
  container.innerHTML = "";

  const white = rules.filter((r) => r.enabled).length;
  const black = rules.length - white;

  const summary = document.getElementById("rules-count");
  if (summary) {
    summary.textContent = `白名单 ${white} 条 · 黑名单 ${black} 条`;
  }

  const groups = new Map();
  for (const rule of rules) {
    if (!groups.has(rule.category)) groups.set(rule.category, []);
    groups.get(rule.category).push(rule);
  }

  for (const [category, list] of groups) {
    const card = document.createElement("div");
    card.className = "card rule-card";

    const heading = document.createElement("h3");
    heading.textContent = RULE_CATEGORY_LABEL[category] || category;

    const count = document.createElement("span");
    count.className = "rule-card-count";
    count.textContent = `${list.filter((r) => r.enabled).length}/${list.length} 白名单`;
    heading.appendChild(count);
    card.appendChild(heading);

    for (const rule of list) {
      rule._onDelete = onDelete;
      card.appendChild(buildRuleRow(rule, onChange));
    }

    container.appendChild(card);
  }
}

// Exposed on window because the page loads plain scripts, not modules.
window.CacheSweepRules = { buildRuleRow, renderRuleList, RULE_CATEGORY_LABEL, RULE_RISK_LABEL };
