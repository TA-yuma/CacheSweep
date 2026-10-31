using System.Runtime.Versioning;
using Microsoft.Win32;

namespace CacheSweep.Core.Scanning;

/// <summary>One installed application and its on-disk footprint.</summary>
public sealed record InstalledApp(
    string Name,
    string? Publisher,
    string? Version,
    string InstallLocation,
    long Bytes,
    int FileCount,
    bool LocationMissing)
{
    /// <summary>
    /// 32×32 PNG of the app's icon, base64-encoded for embedding in JSON.
    /// Null when no icon could be extracted (the UI then draws a letter tile).
    /// </summary>
    public string? IconPng { get; init; }
}

/// <summary>A large file found during a disk walk.</summary>
public sealed record LargeFile(
    string Path,
    string Name,
    long Bytes,
    DateTime LastWriteUtc,
    string Extension);

/// <summary>A top-level folder under a drive root, sized recursively.</summary>
public sealed record FolderUsage(string Path, string Name, long Bytes, int FileCount);

/// <summary>
/// Answers "what is actually using my disk" for the UI. Read-only: nothing here
/// deletes or moves anything.
/// </summary>
public sealed class DiskInventory
{
    private static readonly EnumerationOptions WalkOptions = new()
    {
        RecurseSubdirectories = true,
        IgnoreInaccessible = true,
        AttributesToSkip = FileAttributes.ReparsePoint | FileAttributes.Offline,
        ReturnSpecialDirectories = false,
    };

    /// <summary>
    /// Installed programs from the uninstall registry keys, sized by walking
    /// their install location. Applications whose uninstall entry has no path
    /// are still listed with a zero size so users see them.
    /// </summary>
    public IReadOnlyList<InstalledApp> GetInstalledApps(CancellationToken ct = default)
    {
        // The uninstall inventory only exists on Windows; other hosts get an
        // empty list so the UI degrades instead of throwing.
        if (!OperatingSystem.IsWindows())
        {
            return Array.Empty<InstalledApp>();
        }

        return GetInstalledAppsWindows(ct);
    }

    [SupportedOSPlatform("windows")]
    private static IReadOnlyList<InstalledApp> GetInstalledAppsWindows(CancellationToken ct)
    {
        var apps = new Dictionary<string, InstalledApp>(StringComparer.OrdinalIgnoreCase);

        foreach (var (hive, view) in EnumerateUninstallRoots())
        {
            try
            {
                using var key = RegistryKey.OpenBaseKey(hive, view)
                    .OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall");
                if (key is null)
                {
                    continue;
                }

                foreach (var subName in key.GetSubKeyNames())
                {
                    ct.ThrowIfCancellationRequested();

                    using var sub = key.OpenSubKey(subName);
                    if (sub is null)
                    {
                        continue;
                    }

                    // System components and patches are noise in this view.
                    if (sub.GetValue("SystemComponent") is int sc && sc == 1)
                    {
                        continue;
                    }

                    if (!string.IsNullOrEmpty(sub.GetValue("ParentKeyName") as string))
                    {
                        continue;
                    }

                    var name = sub.GetValue("DisplayName") as string;
                    if (string.IsNullOrWhiteSpace(name))
                    {
                        continue;
                    }

                    var location = NormalizeLocation(sub.GetValue("InstallLocation") as string);
                    if (location is null || apps.ContainsKey(location))
                    {
                        continue;
                    }

                    var (bytes, files, missing) = MeasureLocation(location, ct);

                    // Real program icons make the usage list scannable; the
                    // extractor caches per install location and is cheap when
                    // the entry already has a DisplayIcon.
                    var icon = OperatingSystem.IsWindows()
                        ? AppIconExtractor.Extract(location, sub.GetValue("DisplayIcon") as string)
                        : null;

                    apps[location] = new InstalledApp(
                        name.Trim(),
                        sub.GetValue("Publisher") as string,
                        sub.GetValue("DisplayVersion") as string,
                        location,
                        bytes,
                        files,
                        missing)
                    {
                        IconPng = icon,
                    };
                }
            }
            catch (Exception ex) when (ex is System.Security.SecurityException or UnauthorizedAccessException or IOException)
            {
                // A locked or unreadable hive is skipped, not fatal.
            }
        }

        return apps.Values
            .OrderByDescending(a => a.Bytes)
            .ThenBy(a => a.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    [SupportedOSPlatform("windows")]
    private static IEnumerable<(RegistryHive Hive, RegistryView View)> EnumerateUninstallRoots()
    {
        yield return (RegistryHive.LocalMachine, RegistryView.Registry64);
        yield return (RegistryHive.LocalMachine, RegistryView.Registry32);
        yield return (RegistryHive.CurrentUser, RegistryView.Registry64);
    }

    private static string? NormalizeLocation(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var expanded = Environment.ExpandEnvironmentVariables(raw.Trim().Trim('"'));
        try
        {
            var full = Path.GetFullPath(expanded);
            return full.Length > 3 ? full.TrimEnd('\\') : full;
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return null;
        }
    }

    private static (long Bytes, int Files, bool Missing) MeasureLocation(string location, CancellationToken ct)
    {
        if (!Directory.Exists(location))
        {
            return (0, 0, true);
        }

        try
        {
            var (bytes, files) = DirectoryMeasurer.Measure(location, ct);
            return (bytes, files, false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return (0, 0, false);
        }
    }

    /// <summary>
    /// Largest files under <paramref name="root"/>, newest-first for ties.
    /// Bounded so scanning a whole drive stays responsive.
    /// </summary>
    public IReadOnlyList<LargeFile> FindLargeFiles(
        string root,
        long minBytes = 100L * 1024 * 1024,
        int take = 50,
        CancellationToken ct = default)
    {
        var found = new List<LargeFile>(capacity: take * 2);

        foreach (var (bytes, file) in WalkFiles(root, minBytes, ct))
        {
            found.Add(new LargeFile(
                file.FullName,
                file.Name,
                bytes,
                file.LastWriteTimeUtc,
                file.Extension));

            if (found.Count > take * 4)
            {
                found = found.OrderByDescending(f => f.Bytes).Take(take * 2).ToList();
            }
        }

        return found.OrderByDescending(f => f.Bytes).Take(take).ToList();
    }

    private static IEnumerable<(long Bytes, FileInfo File)> WalkFiles(
        string root, long minBytes, CancellationToken ct)
    {
        IEnumerable<FileInfo> files;
        try
        {
            files = new DirectoryInfo(root).EnumerateFiles("*", WalkOptions);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            yield break;
        }

        // EnumerateFiles is lazy but the try/catch cannot wrap a lazy iterator,
        // so walk through a materialising enumerator with per-item guards.
        using var enumerator = files.GetEnumerator();
        while (true)
        {
            ct.ThrowIfCancellationRequested();

            FileInfo current;
            try
            {
                if (!enumerator.MoveNext())
                {
                    yield break;
                }

                current = enumerator.Current;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                yield break;
            }

            long length;
            try
            {
                length = current.Length;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                continue;
            }

            if (length >= minBytes)
            {
                yield return (length, current);
            }
        }
    }

    /// <summary>Sizes the top-level folders of a drive, largest first.</summary>
    public IReadOnlyList<FolderUsage> GetFolderUsage(
        string driveRoot,
        int take = 20,
        CancellationToken ct = default)
    {
        DirectoryInfo[] dirs;
        try
        {
            dirs = new DirectoryInfo(driveRoot).GetDirectories("*",
                new EnumerationOptions
                {
                    IgnoreInaccessible = true,
                    AttributesToSkip = FileAttributes.ReparsePoint,
                    ReturnSpecialDirectories = false,
                });
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return Array.Empty<FolderUsage>();
        }

        var result = new List<FolderUsage>(dirs.Length);
        foreach (var dir in dirs)
        {
            ct.ThrowIfCancellationRequested();

            // $Recycle.Bin and System Volume Information are measured elsewhere
            // or are not meaningful as user-facing rows.
            if (dir.Name is "$Recycle.Bin" or "System Volume Information" or "$WinREAgent")
            {
                continue;
            }

            var (bytes, files) = DirectoryMeasurer.Measure(dir.FullName, ct);
            result.Add(new FolderUsage(dir.FullName, dir.Name, bytes, files));
        }

        return result.OrderByDescending(f => f.Bytes).Take(take).ToList();
    }

    /// <summary>Free/total space for a drive, used by the summary header.</summary>
    public static (long FreeBytes, long TotalBytes) GetDriveSpace(string driveRoot)
    {
        try
        {
            var info = new DriveInfo(driveRoot);
            return (info.AvailableFreeSpace, info.TotalSize);
        }
        catch (Exception ex) when (ex is IOException or ArgumentException or UnauthorizedAccessException)
        {
            return (0, 0);
        }
    }
}
