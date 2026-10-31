# CacheSweep 运行时骨架（由 scripts/publish.ps1 解释）
#
# 桌面外壳（CacheSweep.exe）负责托盘图标与生命周期；真正干活的
# CacheSweep.Server.exe 由外壳以子进程方式启动并隐藏窗口。两者放在
# 同一目录下一起分发，用户只会看到 CacheSweep.exe。
#
# 为什么不把服务放进同一个 exe：
#   ASP.NET Core 的 Web SDK 自带 Program 入口，作为库被 WinForms 项目
#   引用会和桌面外壳的 Main 冲突；用子进程隔离更稳，服务崩溃也不会
#   带走托盘程序。

set(BUILD_CONFIG Release)
set(RUNTIME win-x64)
set(OUT_DIR artifacts\package)
