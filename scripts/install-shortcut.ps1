# Creates the desktop shortcut for CacheSweep.
#
#   - Points at the packaged CacheSweep.exe (the tray shell)
#   - Uses the branded icon
#   - Starts in the package folder so the server exe and wwwroot resolve
#
# Idempotent: running it again refreshes the existing shortcut.

param(
    [string]$Package = 'E:\CacheSweep\artifacts\package',
    [string]$Name = 'CacheSweep'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$exe = Join-Path $Package 'CacheSweep.exe'
if (-not (Test-Path $exe)) {
    throw "找不到程序：$exe`n请先运行 scripts\publish.ps1 打包。"
}

$server = Join-Path $Package 'CacheSweep.Server.exe'
if (-not (Test-Path $server)) {
    throw "缺少后台服务文件：$server"
}

$icon = Join-Path $Package 'Assets\cachesweep.ico'
if (-not (Test-Path $icon)) {
    $icon = $exe
}

$desktop = [Environment]::GetFolderPath('Desktop')
$linkPath = Join-Path $desktop "$Name.lnk"

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($linkPath)
$link.TargetPath = $exe
$link.WorkingDirectory = $Package
$link.IconLocation = "$icon,0"
$link.Description = 'CacheSweep - 磁盘体检与安全清理'
$link.WindowStyle = 1
$link.Arguments = ''
$link.Save()

[System.Runtime.InteropServices.Marshal]::ReleaseComObject($link) | Out-Null
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null

if (-not (Test-Path $linkPath)) {
    throw "快捷方式创建失败：$linkPath"
}

Write-Host "快捷方式已创建：" -ForegroundColor Green
Write-Host "  $linkPath"
Write-Host "  目标：$exe"
Write-Host "  起始位置：$Package"
Write-Host "  图标：$icon"
