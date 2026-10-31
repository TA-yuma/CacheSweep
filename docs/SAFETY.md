# CacheSweep 安全模型

磁盘清理工具最大的风险是删错东西。CacheSweep 用三道独立防线保证这一点，每一道都经过单元测试。

## 第一道：允许根白名单（Allow-list）

**只有**位于 `SafePathPolicy.AllowedRoots` 中的路径才可能被测量和删除。白名单是**静态数据**，清理规则不能越界。

```csharp
private static readonly string[] AllowedRoots = {
    @"%LOCALAPPDATA%\Temp",
    @"%WINDIR%\Temp",
    @"%LOCALAPPDATA%\pip\Cache",
    ...
};
```

判断逻辑在 `SafePathPolicy.Validate`：

1. 展开环境变量，规范化路径（含 `C:` → `C:\` 修正）
2. 必须为绝对路径，且不能是驱动器根
3. 路径必须以某个允许根 + `\` 开头
4. 否则返回拒绝原因

**为什么是白名单而不是黑名单？** 黑名单永远列不全。新版软件随时会新增 "MegaCache" 目录，主机厂商会新增 "SmartCache"。白名单的默认动作是「拒绝」，未知路径只会被跳过，不会被误删。

## 第二道：永不触碰黑名单（Forbidden list）

即使某条规则通过白名单，若路径命中以下任一模式也会被拒绝：

| 类别 | 例子 |
|---|---|
| 系统核心 | `Windows\System32`、`WinSxS`、`Fonts`、`Installer`、`.NET` |
| 程序目录 | `Program Files`、`Program Files (x86)` |
| 用户数据 | `Documents`、`Desktop`、`Downloads`、`Pictures`、`Music`、`Videos` |
| 凭证/密钥 | `Roaming\Microsoft\Crypto`、`Protect`、`Credentials`、`Vault`、`SystemCertificates` |
| 开始菜单 | `Start Menu`、`SendTo`、`Recent` |

## 第三道：逐条路径复查（Defence in depth）

`Cleaner` 在删除每一个具体文件前**再次**调用 `SafePathPolicy.IsAllowed`。即使规则列表被篡改、目标对象被注入，也删不到白名单外的文件。

```csharp
foreach (var entry in EnumerateEntries(target))
{
    if (!SafePathPolicy.IsAllowed(entry.FullName))
    {
        errors.Add($"refused: {entry.FullName}");
        continue;   // 跳过，不删
    }
    ...
}
```

## 风险分级

| 级别 | 含义 | 默认行为 |
|---|---|---|
| **Safe** | 自动重建，删除不可能丢数据 | 一键清理可选 |
| **Caution** | 可重建，但首次启动会变慢/需重新下载 | 需勾选确认 |
| **Dangerous** | 可能含用户可见数据 | 永不默认勾选；API 需 `allowDangerous: true` |

回收站属于 Dangerous：清空后不可恢复，且它可能包含用户刚删掉但还要找回的文件。

## 进程守卫

规则可声明 `guardProcess`。若该进程正在运行，清理会被拒绝：

```json
{ "id": "thumbnail-cache", "guardProcess": "explorer" }
```

避免在资源管理器占用缩略图数据库时强行删除。扫描阶段仍会测量其体积，只是标记为 `<badge>in-use</badge>`。

## Dry-run 优先

- CLI：默认只预览，`--apply` 才删除
- API：`dryRun` 默认 `true`
- Web UI：必须先点「预览清理」，确认弹窗后才「执行清理」

## 默认删除到回收站

`useRecycleBin` 默认为 `true`，文件可通过资源管理器恢复。只有显式传 `--permanent` 才永久删除。

## 时间保护

`olderThanDays` 让规则只删旧文件。例如 VS Code 日志只清 7 天前的，避免删掉正在写入的日志。

## HTTP 层防护

- 默认只绑定 `127.0.0.1`
- 非 GET 请求校验 `Origin` 头，阻止跨站请求伪造（CSRF）——恶意网页无法通过 `<form>` 驱动本机清理
- 客户端只能提交 **规则 ID**，不能提交路径，路径永远由服务端规则决定

## 审计日志

每次清理写入 `%LOCALAPPDATA%\CacheSweep\logs\cachesweep-YYYY-MM-DD.log`，包含时间、规则、释放字节数和失败原因。

## 测试覆盖

`tests/CacheSweep.Core.Tests` 中的 `SafePathPolicyTests` 断言：

- 所有内置规则路径都通过策略
- `System32`、`Program Files`、`Documents` 等被拒绝
- 相对路径、空路径、驱动器根被拒绝
- 路径穿越（`..`）被规范化后再判断

运行：

```powershell
dotnet test
```
