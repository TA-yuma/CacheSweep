// Capture the real CacheSweep desktop window via PrintWindow to see the actual
// pinned-header behavior without a CDP port.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Cap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$proc = Get-Process -Name "CacheSweep" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if(-not $proc){
  Write-Output "未找到 CacheSweep 窗口"
  exit
}
$hnd = $proc.MainWindowHandle
$rect = New-Object Win32Cap+RECT
[Win32Cap]::GetWindowRect($hnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Output ("窗口: " + $w + "x" + $h)

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[Win32Cap]::PrintWindow($hnd, $hdc, 2) | Out-Null  # PW_RENDERFULLCONTENT = 2
$g.ReleaseHdc($hdc)
$g.Dispose()
$out = "E:\CacheSweep\docs\desktop-window.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("已保存截图: " + $out)