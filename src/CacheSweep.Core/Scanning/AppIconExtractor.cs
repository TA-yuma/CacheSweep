using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;

namespace CacheSweep.Core.Scanning;

/// <summary>
/// Extracts an application's icon so the usage list can show real program icons
/// instead of generic drive glyphs.
///
/// Strategy, cheapest first:
///   1. an executable named in the uninstall entry (DisplayIcon)
///   2. the largest .exe directly inside the install folder
///   3. nothing — the UI falls back to a letter tile
///
/// Icons are downscaled to 32×32 and returned as base64 PNG so a single JSON
/// response can carry them without extra requests.
/// </summary>
[SupportedOSPlatform("windows")]
public static class AppIconExtractor
{
    private const int IconSize = 32;

    /// <summary>Cache keyed by install location; a rescan must not re-extract.</summary>
    private static readonly ConcurrentDictionary<string, string?> Cache =
        new(StringComparer.OrdinalIgnoreCase);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEINFO
    {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szDisplayName;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
        public string szTypeName;
    }

    private const uint SHGFI_ICON = 0x000000100;
    private const uint SHGFI_LARGEICON = 0x000000000;
    private const uint SHGFI_USEFILEATTRIBUTES = 0x000000010;
    private const uint FILE_ATTRIBUTE_NORMAL = 0x80;

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SHGetFileInfo(
        string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbFileInfo, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    /// <summary>
    /// Returns a base64 PNG of the app icon, or null when none can be found.
    /// </summary>
    /// <param name="installLocation">Folder the app lives in.</param>
    /// <param name="displayIcon">
    /// Raw <c>DisplayIcon</c> registry value, which may be a path with an icon
    /// index suffix (",0") and environment variables.
    /// </param>
    public static string? Extract(string installLocation, string? displayIcon)
    {
        if (!OperatingSystem.IsWindows())
        {
            return null;
        }

        var key = string.IsNullOrEmpty(installLocation) ? displayIcon ?? "" : installLocation;
        if (Cache.TryGetValue(key, out var cached))
        {
            return cached;
        }

        var result = ExtractUncached(installLocation, displayIcon);
        Cache[key] = result;
        return result;
    }

    private static string? ExtractUncached(string installLocation, string? displayIcon)
    {
        // 1. Exact icon named by the uninstall entry.
        if (!string.IsNullOrWhiteSpace(displayIcon))
        {
            var path = CleanIconPath(displayIcon);
            if (path is not null)
            {
                var png = FromPath(path);
                if (png is not null)
                {
                    return png;
                }
            }
        }

        // 2. A plausible executable in the install folder.
        var exe = FindMainExecutable(installLocation);
        if (exe is not null)
        {
            return FromPath(exe);
        }

        return null;
    }

    /// <summary>Strips quotes and the trailing ",index" that DisplayIcon may carry.</summary>
    private static string? CleanIconPath(string raw)
    {
        var value = raw.Trim().Trim('"');

        var comma = value.LastIndexOf(',');
        if (comma > 2 && int.TryParse(value[(comma + 1)..], out _))
        {
            value = value[..comma].Trim().Trim('"');
        }

        try
        {
            value = Environment.ExpandEnvironmentVariables(value);
        }
        catch (ArgumentException)
        {
            return null;
        }

        return File.Exists(value) ? value : null;
    }

    /// <summary>
    /// Picks the executable most likely to be the app itself: the largest .exe
    /// in the install folder, skipping updaters and uninstallers.
    /// </summary>
    private static string? FindMainExecutable(string installLocation)
    {
        if (string.IsNullOrWhiteSpace(installLocation) || !Directory.Exists(installLocation))
        {
            return null;
        }

        try
        {
            var candidates = Directory
                .EnumerateFiles(installLocation, "*.exe", SearchOption.TopDirectoryOnly)
                .Where(p => !IsHelperExecutable(Path.GetFileNameWithoutExtension(p)))
                .Select(p => new FileInfo(p))
                .OrderByDescending(f => f.Length)
                .Take(3)
                .ToList();

            return candidates.Count > 0 ? candidates[0].FullName : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static bool IsHelperExecutable(string name)
    {
        string[] noise =
        {
            "unins", "uninstall", "setup", "update", "updater", "crash", "report",
            "helper", "service", "launcher_old", "vc_redist", "dxsetup", "install",
        };

        var lower = name.ToLowerInvariant();
        return noise.Any(n => lower.Contains(n, StringComparison.Ordinal));
    }

    /// <summary>Renders the file's shell icon to a base64 PNG.</summary>
    private static string? FromPath(string path)
    {
        var info = new SHFILEINFO();
        var ok = SHGetFileInfo(path, FILE_ATTRIBUTE_NORMAL, ref info,
            (uint)Marshal.SizeOf<SHFILEINFO>(), SHGFI_ICON | SHGFI_LARGEICON);

        if (ok == IntPtr.Zero || info.hIcon == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            using var icon = System.Drawing.Icon.FromHandle(info.hIcon);
            using var sized = new System.Drawing.Icon(icon, new System.Drawing.Size(IconSize, IconSize));
            using var bmp = sized.ToBitmap();

            using var ms = new MemoryStream();
            bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
            return Convert.ToBase64String(ms.ToArray());
        }
        catch (Exception ex) when (ex is ArgumentException or ExternalException or IOException)
        {
            return null;
        }
        finally
        {
            DestroyIcon(info.hIcon);
        }
    }
}
