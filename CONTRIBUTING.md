# 贡献指南

感谢你考虑为 CacheSweep 做贡献。

## 开始

```powershell
git clone https://github.com/<your-org>/CacheSweep.git
cd CacheSweep
dotnet test          # 必须全部通过
.\scripts\run.ps1    # 启动开发服务
```

需要 **.NET 8 SDK**。

## 目录约定

| 目录 | 放什么 |
|---|---|
| `src/CacheSweep.Core/Models` | 数据模型，纯记录类型，无逻辑 |
| `src/CacheSweep.Core/Safety` | **安全策略**。改动这里必须附带测试 |
| `src/CacheSweep.Core/Rules` | 规则加载与内置规则 JSON |
| `src/CacheSweep.Core/Scanning` | 扫描与体积统计 |
| `src/CacheSweep.Core/Cleaning` | 删除执行器与 Shell API |
| `src/CacheSweep.Server/Api` | HTTP 端点与服务层 |
| `src/CacheSweep.Server/wwwroot` | 浏览器 UI（无构建步骤，原生 JS） |
| `src/CacheSweep.Cli` | 命令行入口 |
| `tests/CacheSweep.Core.Tests` | xUnit 测试 |

## 加一条清理规则

1. 编辑 `src/CacheSweep.Core/Rules/builtin-rules.json`
2. 路径必须落在 `SafePathPolicy.AllowedRoots` 内；若不在，把那**一个目录**加进白名单，并在 PR 里说明为什么它一定可以安全删除
3. 选择正确风险级别：
   - 删了会立刻重建、无感知 → `Safe`
   - 删了要重新下载或首次启动变慢 → `Caution`
   - 可能含用户数据 → `Dangerous`（且要能说明为什么还要清理它）
4. 运行 `dotnet test`，`BuiltInRules_AllPassSafetyPolicy` 会检查
5. 在 PR 描述里给出该目录在该操作系统版本下的真实体积效果

## 改安全策略

`SafePathPolicy` 是整个项目的命门。任何改动必须：

- 附带至少一个正例和反例测试
- 在 PR 里解释攻击面（例如：新白名单能否被 `..` 穿越？能否被符号链接利用？）
- 不通过就不合

## 代码风格

- `TreatWarningsAsErrors` 开启，不能有警告
- 可空引用类型已开启
- 注释写**为什么**，不写**是什么**
- 用户可见文本用中文，代码与日志标识用英文

## 提交

```
feat(rules): 增加 Rustup / cargo 缓存清理
fix(safety): 拒绝经 8.3 短名绕过的路径
docs: 补充用户规则文件示例
test: 覆盖回收站结构体对齐
```

## 发布

打 tag 触发 CI：

```powershell
git tag v0.1.0
git push origin v0.1.0
```

CI 会编译、测试、发布 `win-x64` 自包含单文件，并附到 GitHub Release。
