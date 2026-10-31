"use strict";

/**
 * UI strings for the three supported languages.
 *
 * Keys are stable identifiers; the language files never change shape, only
 * values. Missing keys fall back to English and then to the key itself, so a
 * partially translated build still renders.
 */

const I18N = {
  zh: {
    "app.title": "CacheSweep",
    "app.tagline": "磁盘体检 · 安全清理 · 默认只读",

    "tab.clean": "体检清理",
    "tab.disk": "占用分析",
    "tab.rules": "规则管理",
    "tab.plugins": "插件",
    "tab.settings": "设置",

    "theme.dark": "赤橙 · 暖橙主题",
    "theme.light": "青蔗 · 钢灰主题",
    "theme.transparent": "碧提 · 青提主题",

    "action.scan": "开始体检",
    "action.preview": "预览清理",
    "action.clean": "执行清理",
    "action.cancel": "取消",
    "action.confirm": "确认执行",
    "action.done": "完成",
    "action.selectAll": "全选",
    "action.selectSafe": "只选安全项",
    "action.clearSelection": "清空选择",
    "action.toRecycleBin": "删除到回收站",
    "action.refresh": "刷新",
    "action.stats": "统计",
    "action.add": "添加",

    "summary.total": "可清理总计",
    "summary.safe": "安全 · 可一键",
    "summary.caution": "需确认",
    "summary.danger": "高风险",
    "summary.elapsed": "扫描耗时",
    "summary.installedApps": "已安装程序占用",
    "summary.largeFiles": "大文件合计 (≥100MB)",
    "summary.folders": "目录统计",

    "risk.safe": "安全",
    "risk.caution": "需确认",
    "risk.danger": "高风险",

    "status.ready": "就绪",
    "status.scanning": "正在扫描目录体积…",
    "status.cleaning": "清理中…",
    "status.previewing": "生成预览中…",
    "status.failed": "失败",

    "progress.title.clean": "正在清理",
    "progress.title.preview": "正在生成预览",
    "progress.title.done": "清理完成",
    "progress.title.previewDone": "预览完成",
    "progress.freed": "已释放",
    "progress.files": "已处理文件",
    "progress.failures": "失败",
    "progress.preparing": "准备中…",

    "disk.heading": "磁盘",
    "disk.hint": "点击选择要分析的磁盘",
    "disk.all": "全部",
    "disk.unrestricted": "不限磁盘",
    "disk.drives": "个磁盘",
    "disk.used": "已用",
    "disk.total": "共",
    "disk.free": "可用",
    "disk.system": "已安装程序",
    "disk.largeFiles": "最大的文件",
    "disk.folders": "目录占用",
    "disk.minSize": "最小",
    "disk.viewList": "列表",
    "disk.viewGrid": "卡片",
    "disk.viewCompact": "紧凑",
    "disk.noData": "没有数据",

    "rules.whitelist": "白名单",
    "rules.blacklist": "黑名单",
    "rules.allWhite": "全部设为白名单",
    "rules.cautionBlack": "「需确认」项设为黑名单",
    "rules.allBlack": "全部设为黑名单",
    "rules.customTitle": "添加自定义缓存位置",
    "rules.path": "路径",
    "rules.name": "名称（可选）",
    "rules.risk": "风险级别",
    "rules.custom": "自定义",

    "auto.title": "自动清理",
    "auto.subtitle": "只清理可再生的缓存（图片、视频、临时文件），不碰你的文档",
    "auto.enable": "启用自动清理",
    "auto.frequency": "执行频率",
    "auto.daily": "每天",
    "auto.weekly": "每周",
    "auto.monthly": "每月",
    "auto.at": "执行时间",
    "auto.scope": "清理范围",
    "auto.scopeCacheOnly": "仅缓存（图片 / 视频 / 临时文件）",
    "auto.lastRun": "上次执行",
    "auto.never": "从未执行",
    "auto.runNow": "立即执行一次",
    "auto.whatTitle": "会自动清理的内容",
    "auto.whatDesc": "浏览器图片与视频缓存、缩略图缓存、DirectX 着色器缓存、临时文件、崩溃转储。不会清理回收站、开发者缓存，也不会碰任何文档。",

    "plugins.title": "插件",
    "plugins.subtitle": "按需安装清理模块。未安装的插件不会被扫描，也不会占用资源。",
    "plugins.install": "安装",
    "plugins.uninstall": "卸载",
    "plugins.installed": "已安装",
    "plugins.notInstalled": "未安装",
    "plugins.enable": "启用",
    "plugins.disable": "停用",
    "plugins.enabled": "已启用",
    "plugins.disabled": "已停用",
    "plugins.rules": "条规则",
    "plugins.requiresApp": "需要先安装该软件",

    "settings.title": "设置",
    "settings.appearance": "外观与语言",
    "settings.theme": "主题",
    "settings.language": "界面语言",
    "settings.languageHint": "切换后整个界面立即生效，选择会被记住。",
    "settings.startup": "启动与运行",
    "settings.autostart": "开机自启动",
    "settings.autostartHint": "开启后登录 Windows 时自动在托盘启动 CacheSweep。",
    "settings.startMinimized": "启动时最小化到托盘",
    "settings.startMinimizedHint": "开启后开机不自动弹出窗口，只在托盘运行。",
    "settings.data": "日志与数据",
    "settings.logDir": "日志目录",
    "settings.prefs": "偏好设置",
    "settings.viewAudit": "查看最近操作",
    "settings.about": "关于",
    "settings.autostartOk": "已设置开机自启动",
    "settings.autostartOff": "已关闭开机自启动",
    "settings.autostartFail": "设置失败，请检查权限",
  },

  en: {
    "app.title": "CacheSweep",
    "app.tagline": "Disk health check · safe cleanup · read-only by default",

    "tab.clean": "Clean",
    "tab.disk": "Disk Usage",
    "tab.rules": "Rules",
    "tab.plugins": "Plugins",
    "tab.settings": "Settings",

    "theme.dark": "Ember Orange",
    "theme.light": "Steel Cane",
    "theme.transparent": "Jade Grape",

    "action.scan": "Scan now",
    "action.preview": "Preview",
    "action.clean": "Clean",
    "action.cancel": "Cancel",
    "action.confirm": "Confirm",
    "action.done": "Done",
    "action.selectAll": "Select all",
    "action.selectSafe": "Safe only",
    "action.clearSelection": "Clear",
    "action.toRecycleBin": "Move to Recycle Bin",
    "action.refresh": "Refresh",
    "action.stats": "Load",
    "action.add": "Add",

    "summary.total": "Reclaimable",
    "summary.safe": "Safe · one-click",
    "summary.caution": "Confirm",
    "summary.danger": "High risk",
    "summary.elapsed": "Scan time",
    "summary.installedApps": "Installed apps",
    "summary.largeFiles": "Large files (≥100MB)",
    "summary.folders": "Folders",

    "risk.safe": "Safe",
    "risk.caution": "Caution",
    "risk.danger": "Risk",

    "status.ready": "Ready",
    "status.scanning": "Measuring folders…",
    "status.cleaning": "Cleaning…",
    "status.previewing": "Building preview…",
    "status.failed": "Failed",

    "progress.title.clean": "Cleaning",
    "progress.title.preview": "Building preview",
    "progress.title.done": "Cleanup complete",
    "progress.title.previewDone": "Preview complete",
    "progress.freed": "Freed",
    "progress.files": "Files",
    "progress.failures": "Failed",
    "progress.preparing": "Preparing…",

    "disk.heading": "Drives",
    "disk.hint": "Pick a drive to analyse",
    "disk.all": "All",
    "disk.unrestricted": "Any drive",
    "disk.drives": "drives",
    "disk.used": "Used",
    "disk.total": "Total",
    "disk.free": "Free",
    "disk.system": "Installed apps",
    "disk.largeFiles": "Largest files",
    "disk.folders": "Folder usage",
    "disk.minSize": "Min",
    "disk.viewList": "List",
    "disk.viewGrid": "Grid",
    "disk.viewCompact": "Dense",
    "disk.noData": "No data",

    "rules.whitelist": "Whitelist",
    "rules.blacklist": "Blacklist",
    "rules.allWhite": "All whitelisted",
    "rules.cautionBlack": "Blacklist 'Caution'",
    "rules.allBlack": "All blacklisted",
    "rules.customTitle": "Add a custom cache location",
    "rules.path": "Path",
    "rules.name": "Name (optional)",
    "rules.risk": "Risk",
    "rules.custom": "Custom",

    "auto.title": "Automatic cleanup",
    "auto.subtitle": "Clears regenerable cache only (images, video, temp) — never your documents",
    "auto.enable": "Enable automatic cleanup",
    "auto.frequency": "Frequency",
    "auto.daily": "Daily",
    "auto.weekly": "Weekly",
    "auto.monthly": "Monthly",
    "auto.at": "At",
    "auto.scope": "Scope",
    "auto.scopeCacheOnly": "Cache only (images / video / temp)",
    "auto.lastRun": "Last run",
    "auto.never": "Never",
    "auto.runNow": "Run once now",
    "auto.whatTitle": "What gets cleaned automatically",
    "auto.whatDesc": "Browser image and video caches, thumbnail cache, DirectX shader cache, temp files and crash dumps. The Recycle Bin and developer caches are never touched, and no document is ever deleted.",

    "plugins.title": "Plugins",
    "plugins.subtitle": "Install cleanup modules on demand. Uninstalled plugins are never scanned and cost nothing.",
    "plugins.install": "Install",
    "plugins.uninstall": "Uninstall",
    "plugins.installed": "Installed",
    "plugins.notInstalled": "Not installed",
    "plugins.enable": "Enable",
    "plugins.disable": "Disable",
    "plugins.enabled": "Enabled",
    "plugins.disabled": "Disabled",
    "plugins.rules": "rules",
    "plugins.requiresApp": "Requires the app to be installed",

    "settings.title": "Settings",
    "settings.appearance": "Appearance & language",
    "settings.theme": "Theme",
    "settings.language": "Language",
    "settings.languageHint": "Applies immediately across the whole UI and is remembered.",
    "settings.startup": "Startup",
    "settings.autostart": "Start with Windows",
    "settings.autostartHint": "Launch CacheSweep in the tray when you sign in.",
    "settings.startMinimized": "Start minimised to tray",
    "settings.startMinimizedHint": "Do not pop the window open at login.",
    "settings.data": "Logs & data",
    "settings.logDir": "Log folder",
    "settings.prefs": "Preferences",
    "settings.viewAudit": "View recent activity",
    "settings.about": "About",
    "settings.autostartOk": "Autostart enabled",
    "settings.autostartOff": "Autostart disabled",
    "settings.autostartFail": "Could not change autostart; check permissions",
  },

  ru: {
    "app.title": "CacheSweep",
    "app.tagline": "Проверка диска · безопасная очистка · только чтение по умолчанию",

    "tab.clean": "Очистка",
    "tab.disk": "Диск",
    "tab.rules": "Правила",
    "tab.plugins": "Плагины",
    "tab.settings": "Настройки",

    "theme.dark": "Янтарный",
    "theme.light": "Стальной",
    "theme.transparent": "Нефритовый",

    "action.scan": "Проверить",
    "action.preview": "Предпросмотр",
    "action.clean": "Очистить",
    "action.cancel": "Отмена",
    "action.confirm": "Подтвердить",
    "action.done": "Готово",
    "action.selectAll": "Выбрать всё",
    "action.selectSafe": "Только безопасные",
    "action.clearSelection": "Снять выбор",
    "action.toRecycleBin": "В корзину",
    "action.refresh": "Обновить",
    "action.stats": "Загрузить",
    "action.add": "Добавить",

    "summary.total": "Можно освободить",
    "summary.safe": "Безопасно",
    "summary.caution": "Подтвердить",
    "summary.danger": "Риск",
    "summary.elapsed": "Время проверки",
    "summary.installedApps": "Программы",
    "summary.largeFiles": "Крупные файлы (≥100МБ)",
    "summary.folders": "Папки",

    "risk.safe": "Безопасно",
    "risk.caution": "Осторожно",
    "risk.danger": "Риск",

    "status.ready": "Готово",
    "status.scanning": "Измерение папок…",
    "status.cleaning": "Очистка…",
    "status.previewing": "Подготовка предпросмотра…",
    "status.failed": "Ошибка",

    "progress.title.clean": "Очистка",
    "progress.title.preview": "Предпросмотр",
    "progress.title.done": "Очистка завершена",
    "progress.title.previewDone": "Предпросмотр готов",
    "progress.freed": "Освобождено",
    "progress.files": "Файлов",
    "progress.failures": "Ошибок",
    "progress.preparing": "Подготовка…",

    "disk.heading": "Диски",
    "disk.hint": "Выберите диск для анализа",
    "disk.all": "Все",
    "disk.unrestricted": "Любой диск",
    "disk.drives": "дисков",
    "disk.used": "Занято",
    "disk.total": "Всего",
    "disk.free": "Свободно",
    "disk.system": "Программы",
    "disk.largeFiles": "Крупнейшие файлы",
    "disk.folders": "Размер папок",
    "disk.minSize": "Мин",
    "disk.viewList": "Список",
    "disk.viewGrid": "Плитка",
    "disk.viewCompact": "Плотно",
    "disk.noData": "Нет данных",

    "rules.whitelist": "Белый список",
    "rules.blacklist": "Чёрный список",
    "rules.allWhite": "Всё в белый список",
    "rules.cautionBlack": "«Осторожно» в чёрный",
    "rules.allBlack": "Всё в чёрный список",
    "rules.customTitle": "Добавить свою папку кэша",
    "rules.path": "Путь",
    "rules.name": "Название (необязательно)",
    "rules.risk": "Уровень риска",
    "rules.custom": "Своё",

    "auto.title": "Автоматическая очистка",
    "auto.subtitle": "Удаляет только восстанавливаемый кэш (изображения, видео, временные файлы)",
    "auto.enable": "Включить автоочистку",
    "auto.frequency": "Периодичность",
    "auto.daily": "Ежедневно",
    "auto.weekly": "Еженедельно",
    "auto.monthly": "Ежемесячно",
    "auto.at": "Время",
    "auto.scope": "Область",
    "auto.scopeCacheOnly": "Только кэш (изображения / видео / временные)",
    "auto.lastRun": "Последний запуск",
    "auto.never": "Никогда",
    "auto.runNow": "Запустить сейчас",
    "auto.whatTitle": "Что очищается автоматически",
    "auto.whatDesc": "Кэш изображений и видео браузеров, кэш миниатюр, кэш шейдеров DirectX, временные файлы и дампы сбоев. Корзина и кэш разработчиков не затрагиваются, документы не удаляются.",

    "plugins.title": "Плагины",
    "plugins.subtitle": "Устанавливайте модули очистки по необходимости. Неустановленные плагины не сканируются.",
    "plugins.install": "Установить",
    "plugins.uninstall": "Удалить",
    "plugins.installed": "Установлен",
    "plugins.notInstalled": "Не установлен",
    "plugins.enable": "Включить",
    "plugins.disable": "Отключить",
    "plugins.enabled": "Включён",
    "plugins.disabled": "Отключён",
    "plugins.rules": "правил",
    "plugins.requiresApp": "Требуется установленная программа",

    "settings.title": "Настройки",
    "settings.appearance": "Вид и язык",
    "settings.theme": "Тема",
    "settings.language": "Язык интерфейса",
    "settings.languageHint": "Применяется сразу ко всему интерфейсу и запоминается.",
    "settings.startup": "Запуск",
    "settings.autostart": "Запускать при входе",
    "settings.autostartHint": "Запускать CacheSweep в трее при входе в Windows.",
    "settings.startMinimized": "Запускать свёрнутым в трей",
    "settings.startMinimizedHint": "Не открывать окно при входе.",
    "settings.data": "Журналы и данные",
    "settings.logDir": "Папка журналов",
    "settings.prefs": "Настройки",
    "settings.viewAudit": "Последние действия",
    "settings.about": "О программе",
    "settings.autostartOk": "Автозапуск включён",
    "settings.autostartOff": "Автозапуск выключен",
    "settings.autostartFail": "Не удалось изменить автозапуск",
  },
};

/** Resolves a key for the active language, falling back to English. */
function t(key, lang) {
  const language = lang || document.documentElement.dataset.lang || "zh";
  const table = I18N[language] || I18N.en;
  return table[key] ?? I18N.en[key] ?? key;
}

/** Applies translations to every element carrying data-i18n. */
function applyLanguage(lang) {
  const language = I18N[lang] ? lang : "en";
  document.documentElement.dataset.lang = language;
  document.documentElement.lang = language === "zh" ? "zh-CN" : language;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const value = t(key, language);
    if (el.placeholder !== undefined && el.dataset.i18nAttr === "placeholder") {
      el.placeholder = value;
    } else {
      el.textContent = value;
    }
  });

  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle, language);
  });

  try {
    localStorage.setItem("cachesweep.lang", language);
  } catch {
    /* private mode */
  }
}

window.CacheSweepI18n = { I18N, t, applyLanguage };
