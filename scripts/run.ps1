# CacheSweep

启动本地服务并在浏览器打开 http://127.0.0.1:5188
参数:
  -Port 5188     监听端口
  -NoBrowser     不自动打开浏览器
  -Configuration Debug|Release（默认 Debug）

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

param(
  [int]$Port = 5188,
  [switch]$NoBrowser,
  [string]$Configuration = 'Debug'
)

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $env:urls = "http://127.0.0.1:$Port"
  if ($NoBrowser) { $env:noBrowser = 'true' }

  Write-Host "CacheSweep 启动中 -> http://127.0.0.1:$Port" -ForegroundColor Cyan
  dotnet run --project "$root\src\CacheSweep.Server" -c $Configuration --urls $env:urls
}
finally {
  Pop-Location
}
