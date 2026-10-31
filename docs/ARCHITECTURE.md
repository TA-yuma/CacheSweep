# 架构

```
┌──────────────────────────────────────────────────────────────┐
│                    浏览器（Web UI 同一套）                      │
│  index.html + app.css + app.js   只调用 /api/*，从不碰文件系统   │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTP (127.0.0.1)
┌──────────────────────────▼───────────────────────────────────┐
│                   CacheSweep.Server                           │
│  Program.cs      最小 API 宿主、静态文件、CSRF 校验、自动开浏览器 │
│  Api/SweepService.cs   持有规则与上次扫描，记录审计日志          │
│  Api/ApiEndpoints.cs   /health /targets /scan /clean          │
└──────────────────────────┬───────────────────────────────────┘
                           │ 项目引用
┌──────────────────────────▼───────────────────────────────────┐
│                   CacheSweep.Core                             │
│                                                               │
│  Rules/BuiltInRules.cs   内嵌规则 + 用户规则合并               │
│  Rules/RuleLoader.cs     JSON → CleanTarget，含拒绝原因        │
│  Safety/SafePathPolicy.cs ★ 安全命门：白名单 / 黑名单          │
│  Scanning/Scanner.cs     遍历目录体积，尊重重解析点            │
│  Cleaning/Cleaner.cs     逐条复查路径后删除 / dry-run          │
│  Cleaning/RecycleBin.cs  Shell API：查询与清空回收站           │
└──────────────────────────┬───────────────────────────────────┘
                           │ 项目引用
┌──────────────────────────▼───────────────────────────────────┐
│                   CacheSweep.Cli                              │
│  list / scan / clean  —— 适合脚本与计划任务                    │
└──────────────────────────────────────────────────────────────┘
```

## 数据流

1. **启动**：`SweepService` 加载内嵌规则，可选合并 `%APPDATA%\CacheSweep\rules.json`。每条路径经 `SafePathPolicy` 校验，失败者进入 `rejected` 列表。
2. **扫描**：`Scanner` 对每个目标调用 `DirectoryMeasurer.Measure`，得到字节数与文件数，同时检测进程守卫。返回 `ScanReport`。
3. **清理**：客户端只提交**规则 ID 数组**。`Cleaner` 按 ID 找到目标，重新验证路径，枚举条目，逐条复查路径后删除。
4. **审计**：每一步写入日志文件。

## 为什么客户端只能发 ID

如果 API 接受任意路径，一次 XSS 或恶意网页就能让本机删除任意目录。接受 ID 后，可删路径集合在服务启动时由规则**完全确定**，客户端无法扩展。

## 规则文件格式

```json
{
  "schemaVersion": "1",
  "targets": [
    {
      "id": "my-cache",
      "name": "我的缓存",
      "description": "说明它会做什么",
      "path": "%LOCALAPPDATA%\\MyApp\\Cache",
      "category": "AppCache",
      "risk": "Caution",
      "strategy": "ContentsOfDirectory",
      "match": "All",
      "olderThanDays": 0,
      "guardProcess": "MyApp"
    }
  ]
}
```

### 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 唯一标识，API 与 CLI 用它引用目标 |
| `name` / `description` | 建议 | 界面显示文本 |
| `path` | 是 | 支持 `%VAR%` 环境变量，**必须**通过安全策略 |
| `category` | 是 | `TempFiles` `BrowserCache` `AppCache` `SystemCache` `DeveloperCache` `CrashAndDiagnostics` `RecycleBin` |
| `risk` | 是 | `Safe` / `Caution` / `Dangerous` |
| `strategy` | 否 | `ContentsOfDirectory`（默认）/ `MatchingEntries` / `WholeDirectory` / `RecycleBin` |
| `match` | 否 | `All`（默认）/ `Extensions` / `Patterns` |
| `extensions` | 否 | `[".db", ".tmp"]`，配合 `match: Extensions` |
| `namePatterns` | 否 | `["DXCache", "*.tmp"]`，配合 `match: Patterns` |
| `olderThanDays` | 否 | 只删 N 天前的条目，`0` 表示不过滤 |
| `guardProcess` | 否 | 该进程运行时跳过 |

### 用户规则位置

`%APPDATA%\CacheSweep\rules.json`（与内置规则同格式）。用户规则只能**新增**，不能覆盖内置规则的 ID。

## 新增一个规则

1. 在 `src/CacheSweep.Core/Rules/builtin-rules.json` 追加对象
2. 确认 `path` 在 `SafePathPolicy.AllowedRoots` 中——如果不在，需要在白名单里显式加入，并说明理由
3. `dotnet test` —— `BuiltInRules_AllPassSafetyPolicy` 会验证
4. 在 README 的特性表补充说明
