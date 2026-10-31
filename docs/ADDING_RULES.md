# 安全策略：添加一条自定义清理规则

> 本文面向想扩展清理范围的贡献者。README 已说明内置规则；
> 这里讲清楚**什么样的路径可以加、怎么加、怎么验证**。

## 先理解边界

CacheSweep 的删除范围由 `src/CacheSweep.Core/Safety/SafePathPolicy.cs` 决定，
它有两份清单：

1. **允许根白名单**（`AllowedRoots`）：只有位于这些目录之下的路径才可能被清理
2. **永不触碰黑名单**（`ForbiddenFragments`）：即使落在白名单内，命中这些模式也拒绝

一份规则要通过**两次**校验才会生效：

```
规则 JSON → SafePathPolicy.Validate() → 进入可清理列表
删除每个文件前 → SafePathPolicy.IsAllowed() → 才真正删除
```

## 加一条规则

### 1. 确认路径在白名单内

先查 `AllowedRoots`。如果你的目标目录不在其中，需要**只添加那一个具体目录**，
而不是添加它的父目录。

```csharp
// 好：只开一个口子
@"%LOCALAPPDATA%\MyApp\Cache",

// 坏：把整个 AppData 都放进来
@"%LOCALAPPDATA%",
```

### 2. 选择风险级别

| 级别 | 判断标准 | 例子 |
|---|---|---|
| `Safe` | 删除后程序自动重建，用户无感知 | 临时文件、崩溃转储 |
| `Caution` | 会重新下载 / 首次启动变慢 | 浏览器缓存、包管理器缓存 |
| `Dangerous` | 可能含用户可见数据 | 回收站、pnpm store |

拿不准时选 `Caution`。

### 3. 写进规则文件

编辑 `src/CacheSweep.Core/Rules/builtin-rules.json`：

```json
{
  "id": "my-app-cache",
  "name": "我的应用缓存",
  "description": "这句话会显示在界面上，说明删除会有什么影响",
  "path": "%LOCALAPPDATA%\\MyApp\\Cache",
  "category": "AppCache",
  "risk": "Caution",
  "strategy": "ContentsOfDirectory",
  "guardProcess": "MyApp"
}
```

字段说明见 [ARCHITECTURE.md](ARCHITECTURE.md)。

### 4. 运行测试

```powershell
dotnet test
```

以下测试会自动检查你的规则：

- `BuiltInRules_AllPassSafetyPolicy`：所有内置规则都必须通过安全策略
- `RulePointingAtSystem32_IsRejected`：确认危险路径会被拒绝
- `BuiltInRules_HaveUniqueIds`：规则 ID 不重复

### 5. 实测体积

在 PR 描述里给出这条目录在你机器上的**真实大小**，以及删除后程序的表现。
这比"应该能省很多空间"有说服力。

## 不要做的事

- ❌ 不要为了让规则通过而放宽白名单到某个大目录
- ❌ 不要添加会删除用户文档、下载、桌面内容的规则
- ❌ 不要添加 `Program Files` 下的路径（那是已安装软件本体）
- ❌ 不要在 `description` 里含糊其辞，要写清楚删了会怎样

## 如果必须改安全策略

`SafePathPolicy` 是整个项目的命门。改动必须：

1. 附带至少一个正例和一个反例测试
2. 在 PR 里解释攻击面（能否被 `..` 穿越？能否被符号链接利用？）
3. 说明为什么这个目录**一定**可以安全删除

不满足以上条件的 PR 不会合并。
