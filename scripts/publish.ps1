# 打包 CacheSweep 桌面版（Windows x64）
#
# 产物布局:
#   artifacts\package\CacheSweep.exe         桌面外壳（托盘，双击启动）
#   artifacts\package\CacheSweep.Server.exe  后台服务（由外壳自动启动）
#   artifacts\package\wwwroot\               网页界面
#   artifacts\package\Assets\                图标
#
# 同时输出:
#   artifacts\dist\CacheSweep-win-x64.zip    可分发的压缩包
#   artifacts\publish-cli\cachesweep.exe     命令行版

param(
    [switch]$SkipTests,
    [switch]$SkipZip
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$package = Join-Path $root 'artifacts\package'
$cliOut = Join-Path $root 'artifacts\publish-cli'
$dist = Join-Path $root 'artifacts\dist'
$runtime = 'win-x64'

Push-Location $root
try {
    if (-not $SkipTests) {
        Write-Host '==> 运行测试' -ForegroundColor Cyan
        dotnet test "$root\CacheSweep.sln" -c Release --nologo
        if ($LASTEXITCODE -ne 0) { throw '测试失败，已中止打包' }
    }

    Write-Host '==> 清理旧产物' -ForegroundColor Cyan
    foreach ($dir in @($package, $cliOut, $dist)) {
        if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    }
    New-Item -ItemType Directory -Force -Path $package, $dist | Out-Null

    Write-Host '==> 发布后台服务' -ForegroundColor Cyan
    dotnet publish "$root\src\CacheSweep.Server" -c Release -r $runtime `
        --self-contained true -p:PublishSingleFile=true `
        -p:EnableCompressionInSingleFile=true -o $package --nologo
    if ($LASTEXITCODE -ne 0) { throw '服务端发布失败' }

    Write-Host '==> 发布桌面外壳' -ForegroundColor Cyan
    dotnet publish "$root\src\CacheSweep.Desktop" -c Release -r $runtime -o $package --nologo
    if ($LASTEXITCODE -ne 0) { throw '桌面外壳发布失败' }

    Write-Host '==> 发布 CLI' -ForegroundColor Cyan
    dotnet publish "$root\src\CacheSweep.Cli" -c Release -r $runtime `
        --self-contained true -p:PublishSingleFile=true `
        -p:EnableCompressionInSingleFile=true -o $cliOut --nologo
    if ($LASTEXITCODE -ne 0) { throw 'CLI 发布失败' }

    # Symbols are not shipped.
    Get-ChildItem $package -Filter '*.pdb' | Remove-Item -Force -ErrorAction SilentlyContinue

    # The publish step only knows about compile output, so the icons are copied
    # explicitly: the base icon, and the three per-theme marks the shell swaps
    # when the user changes theme.
    $assetsDir = Join-Path $package 'Assets'
    New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null

    $iconSrc = Join-Path $root 'src\CacheSweep.Desktop\Assets\cachesweep.ico'
    if (Test-Path $iconSrc) {
        Copy-Item $iconSrc (Join-Path $assetsDir 'cachesweep.ico') -Force
    }

    $themeIconSrc = Join-Path $root 'src\CacheSweep.Desktop\Assets\themes'
    if (Test-Path $themeIconSrc) {
        $themeDest = Join-Path $assetsDir 'themes'
        New-Item -ItemType Directory -Force -Path $themeDest | Out-Null
        Copy-Item (Join-Path $themeIconSrc '*.ico') $themeDest -Force
        $copied = (Get-ChildItem $themeDest -Filter '*.ico' | Measure-Object).Count
        if ($copied -lt 3) {
            throw "主题图标不完整：期望 3 个，实际 $copied 个"
        }
    }
    else {
        throw "缺少主题图标目录：$themeIconSrc"
    }

    if (-not $SkipZip) {
        Write-Host '==> 生成分发包' -ForegroundColor Cyan
        $zip = Join-Path $dist 'CacheSweep-win-x64.zip'
        Compress-Archive -Path (Join-Path $package '*') -DestinationPath $zip -Force
        $cliZip = Join-Path $dist 'CacheSweep-cli-win-x64.zip'
        Compress-Archive -Path (Join-Path $cliOut '*') -DestinationPath $cliZip -Force
    }

    Write-Host "`n==> 完成" -ForegroundColor Green
    Get-ChildItem $package | Where-Object { -not $_.PSIsContainer } |
        Select-Object Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } |
        Format-Table -AutoSize
    Get-ChildItem $dist -ErrorAction SilentlyContinue |
        Select-Object Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } |
        Format-Table -AutoSize
}
finally {
    Pop-Location
}
