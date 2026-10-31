using System.Runtime.Versioning;
using Microsoft.Win32;

namespace CacheSweep.Core.Automation;

/// <summary>
/// Manages "start with Windows" through the per-user Run key.
///
/// HKCU is used deliberately: it needs no elevation, and autostart is a
/// per-user preference. Nothing here writes to HKLM.
/// </summary>
[SupportedOSPlatform("windows")]
public static class StartupManager
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "CacheSweep";

    /// <summary>True when the Run entry exists and points at an existing file.</summary>
    public static bool IsEnabled(string? expectedPath = null)
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath);
            var value = key?.GetValue(ValueName) as string;
            if (string.IsNullOrWhiteSpace(value))
            {
                return false;
            }

            var path = ExtractPath(value);
            return expectedPath is null
                   || path.Equals(expectedPath, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            return false;
        }
    }

    /// <summary>
    /// Enables autostart. <paramref name="executablePath"/> is the tray shell;
    /// <paramref name="startMinimized"/> adds --tray so it opens silently.
    /// </summary>
    public static bool Enable(string executablePath, bool startMinimized)
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true);
            if (key is null)
            {
                return false;
            }

            var command = startMinimized
                ? $"\"{executablePath}\" --tray"
                : $"\"{executablePath}\"";

            key.SetValue(ValueName, command, RegistryValueKind.String);
            return true;
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            return false;
        }
    }

    /// <summary>Removes the autostart entry. Returns true when it is gone.</summary>
    public static bool Disable()
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
            if (key is null)
            {
                return true;
            }

            if (key.GetValue(ValueName) is not null)
            {
                key.DeleteValue(ValueName, throwOnMissingValue: false);
            }

            return true;
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            return false;
        }
    }

    /// <summary>Reads the active command line, for display in settings.</summary>
    public static string? CurrentCommand()
    {
        if (!OperatingSystem.IsWindows())
        {
            return null;
        }

        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath);
            return key?.GetValue(ValueName) as string;
        }
        catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            return null;
        }
    }

    /// <summary>Strips the surrounding quotes and any arguments.</summary>
    private static string ExtractPath(string command)
    {
        var trimmed = command.Trim();
        if (trimmed.StartsWith('"'))
        {
            var end = trimmed.IndexOf('"', 1);
            return end > 0 ? trimmed[1..end] : trimmed.Trim('"');
        }

        // Unquoted: the path ends at the first space that starts an argument.
        var space = trimmed.IndexOf(" --", StringComparison.Ordinal);
        return space > 0 ? trimmed[..space] : trimmed;
    }
}
