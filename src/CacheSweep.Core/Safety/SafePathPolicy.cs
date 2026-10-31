using System.Text.RegularExpressions;
using CacheSweep.Core.Models;

namespace CacheSweep.Core.Safety;

/// <summary>
/// The single hard boundary of CacheSweep. Every path that will be measured or
/// deleted must pass <see cref="Validate"/>. Rules are data, not code, so a
/// malicious or sloppy rule cannot widen the blast radius: a path is only
/// cleanable if it sits inside an allow-listed root AND never matches a
/// forbidden pattern.
/// </summary>
public static class SafePathPolicy
{
    /// <summary>
    /// Folders whose contents may be deleted. Deliberately narrow.
    /// </summary>
    private static readonly string[] AllowedRoots =
    {
        @"%LOCALAPPDATA%\Temp",
        @"%WINDIR%\Temp",
        @"%WINDIR%\SoftwareDistribution\Download",
        @"%WINDIR%\Logs\CBS",
        @"%LOCALAPPDATA%\Microsoft\Windows\Explorer",
        @"%LOCALAPPDATA%\Microsoft\Windows\INetCache",
        @"%LOCALAPPDATA%\Microsoft\Windows\WER",
        @"%LOCALAPPDATA%\CrashDumps",
        @"%LOCALAPPDATA%\D3DSCache",
        @"%LOCALAPPDATA%\NVIDIA",
        @"%LOCALAPPDATA%\NVIDIA Corporation",
        @"%LOCALAPPDATA%\pip\Cache",
        @"%LOCALAPPDATA%\pnpm\store",
        @"%LOCALAPPDATA%\pnpm-store",
        @"%LOCALAPPDATA%\Yarn\Cache",
        @"%LOCALAPPDATA%\NuGet\v3-cache",
        @"%LOCALAPPDATA%\Microsoft\Edge\User Data",
        @"%LOCALAPPDATA%\Google\Chrome\User Data",
        @"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data",
        @"%APPDATA%\npm-cache",
        @"%APPDATA%\Code\Cache",
        @"%APPDATA%\Code\CachedData",
        @"%APPDATA%\Code\CachedExtensionVSIXs",
        @"%APPDATA%\Code\Service Worker\CacheStorage",
        @"%APPDATA%\Code\GPUCache",
        @"%APPDATA%\Code\logs",
        // Recycle Bin is measured and emptied through the shell API, never by
        // walking the directory, but it still needs to pass the allow-list.
        @"%SystemDrive%\$Recycle.Bin",
    };

    /// <summary>
    /// Never deletable, even if a rule somehow points at them. Anything that can
    /// break the OS, the user's documents, or their credentials.
    /// </summary>
    private static readonly string[] ForbiddenFragments =
    {
        @"\Windows\System32",
        @"\Windows\SysWOW64",
        @"\Windows\WinSxS",
        @"\Windows\System",
        @"\Windows\Fonts",
        @"\Windows\Installer",
        @"\Windows\assembly",
        @"\Windows\Microsoft.NET",
        @"\Program Files",
        @"\Program Files (x86)",
        @"\ProgramData\Microsoft\Windows\Start Menu",
        @"\Users\Default",
        @"\Users\Public\Documents",
        @"\AppData\Roaming\Microsoft\Windows\Cookies",
        @"\AppData\Roaming\Microsoft\Windows\Network Shortcuts",
        @"\AppData\Roaming\Microsoft\Windows\Start Menu",
        @"\AppData\Roaming\Microsoft\Windows\SendTo",
        @"\AppData\Roaming\Microsoft\Windows\Recent",
        @"\AppData\Roaming\Microsoft\Crypto",
        @"\AppData\Roaming\Microsoft\Protect",
        @"\AppData\Roaming\Microsoft\SystemCertificates",
        @"\AppData\Roaming\Microsoft\Vault",
        @"\AppData\Roaming\Microsoft\Credentials",
        @"\AppData\Roaming\Microsoft\Templates",
        @"\Documents",
        @"\Desktop",
        @"\Downloads",
        @"\Pictures",
        @"\Videos",
        @"\Music",
        @"\OneDrive",
        @"\$Recycle.Bin\$I",
        @"\Boot",
        @"\EFI",
        @"\System Volume Information",
        @"\Recovery",
        @"\PerfLogs",
    };

    private static readonly string[] AllowedRootPaths =
        AllowedRoots.Select(NormalizePath).ToArray();

    public static string NormalizePath(string raw)
    {
        var expanded = Environment.ExpandEnvironmentVariables(raw.Trim());

        // "%SystemDrive%" expands to "C:" with no trailing separator, which
        // Path.GetFullPath resolves against the current directory. Treat a bare
        // drive as that drive's root so policy comparisons stay correct.
        if (expanded.Length == 2 && expanded[1] == ':')
        {
            expanded += '\\';
        }

        var full = Path.GetFullPath(expanded);
        if (full.Length > 3)
        {
            full = full.TrimEnd('\\', '/');
        }

        return full;
    }

    /// <summary>
    /// Returns null when the path is allowed for measurement/deletion,
    /// otherwise a human-readable reason why it was rejected.
    /// </summary>
    public static string? Validate(string rawPath)
    {
        if (string.IsNullOrWhiteSpace(rawPath))
        {
            return "Path is empty.";
        }

        // Reject environment variables that did not expand: a rule must never
        // silently target the literal string "%TEMP%".
        if (rawPath.Contains('%') && !Environment.ExpandEnvironmentVariables(rawPath).Contains('%'))
        {
            return "Path could not be expanded.";
        }

        string full;
        try
        {
            full = NormalizePath(rawPath);
        }
        catch (Exception ex)
        {
            return $"Path is invalid: {ex.Message}";
        }

        if (!Path.IsPathFullyQualified(full))
        {
            return "Path must be absolute.";
        }

        if (string.Equals(full, Path.GetPathRoot(full), StringComparison.OrdinalIgnoreCase))
        {
            return "Refusing to operate on a drive root.";
        }

        var probe = full + @"\";
        foreach (var fragment in ForbiddenFragments)
        {
            if (probe.Contains(fragment + @"\", StringComparison.OrdinalIgnoreCase)
                || (fragment.EndsWith(@"\$I", StringComparison.OrdinalIgnoreCase)
                    && probe.Contains(fragment, StringComparison.OrdinalIgnoreCase)))
            {
                return $"Path is on the never-touch list ({fragment.TrimStart('\\')}).";
            }
        }

        foreach (var root in AllowedRootPaths)
        {
            if (probe.StartsWith(root + @"\", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }
        }

        return "Path is outside every allow-listed cache root.";
    }

    public static bool IsAllowed(string rawPath) => Validate(rawPath) is null;

    /// <summary>
    /// True when <paramref name="candidate"/> is the same as, or nested inside,
    /// <paramref name="parent"/>. Used to block deleting a directory that would
    /// take out a live target elsewhere.
    /// </summary>
    public static bool IsSameOrInside(string candidate, string parent)
    {
        var c = NormalizePath(candidate);
        var p = NormalizePath(parent);
        return string.Equals(c, p, StringComparison.OrdinalIgnoreCase)
               || c.StartsWith(p + @"\", StringComparison.OrdinalIgnoreCase);
    }
}
