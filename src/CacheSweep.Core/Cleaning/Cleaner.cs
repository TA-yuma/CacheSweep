using System.Diagnostics;
using System.Text.RegularExpressions;
using CacheSweep.Core.Models;
using CacheSweep.Core.Safety;
using CacheSweep.Core.Scanning;

namespace CacheSweep.Core.Cleaning;

public sealed class CleanOptions
{
    /// <summary>When true, compute the outcome without deleting anything.</summary>
    public bool DryRun { get; init; } = true;

    /// <summary>Send deleted files to the Recycle Bin instead of permanent deletion.</summary>
    public bool UseRecycleBin { get; init; } = true;

    /// <summary>Allow targets classified as <see cref="RiskLevel.Dangerous"/>.</summary>
    public bool AllowDangerous { get; init; }

    /// <summary>Best-effort deletion of locked files (impersonation-free fallback only).</summary>
    public bool Force { get; init; }
}

/// <summary>
/// Deletes only targets the caller explicitly selected. Every individual path
/// is re-validated against <see cref="SafePathPolicy"/> immediately before
/// deletion, so even a tampered target list cannot escape the allow-list.
/// </summary>
public sealed class Cleaner
{
    private readonly IReadOnlyDictionary<string, CleanTarget> _targets;
    private readonly Action<string>? _log;

    public Cleaner(IReadOnlyList<CleanTarget> targets, Action<string>? log = null)
    {
        _targets = targets.ToDictionary(t => t.Id, StringComparer.OrdinalIgnoreCase);
        _log = log;
    }

    /// <summary>
    /// Cleans the given targets in order.
    /// </summary>
    /// <param name="targetIds">Ids to process; duplicates are ignored.</param>
    /// <param name="options">Dry-run / recycle-bin / dangerous opt-in.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <param name="onProgress">
    /// Invoked from the calling thread after each target finishes, so a UI can
    /// show real progress instead of an indeterminate spinner. The callback
    /// receives the just-completed item plus 1-based counters.
    /// </param>
    public CleanResult Clean(
        IEnumerable<string> targetIds,
        CleanOptions options,
        CancellationToken ct = default,
        Action<CleanProgress>? onProgress = null)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTimeOffset.Now;
        var results = new List<CleanResultItem>();
        var ordered = targetIds.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var total = ordered.Count;

        for (var index = 0; index < ordered.Count; index++)
        {
            ct.ThrowIfCancellationRequested();

            var id = ordered[index];
            var item = _targets.TryGetValue(id, out var target)
                ? CleanOne(target, options, ct)
                : new CleanResultItem(id, "(unknown)", string.Empty, 0, 0, false, "Unknown target id.");

            results.Add(item);

            onProgress?.Invoke(new CleanProgress(
                Index: index + 1,
                Total: total,
                TargetCount: total,
                Item: item,
                FreedBytesSoFar: results.Sum(r => r.Success ? r.FreedBytes : 0),
                FilesSoFar: results.Sum(r => r.Success ? r.DeletedFiles : 0),
                FailuresSoFar: results.Count(r => !r.Success)));
        }

        sw.Stop();
        return new CleanResult
        {
            DryRun = options.DryRun,
            StartedAt = startedAt,
            DurationMs = sw.ElapsedMilliseconds,
            Items = results,
        };
    }

    private CleanResultItem CleanOne(CleanTarget target, CleanOptions options, CancellationToken ct)
    {
        if (!target.Enabled)
        {
            return Fail(target, "Target is on your ignore list.");
        }

        if (target.Risk == RiskLevel.Dangerous && !options.AllowDangerous)
        {
            return Fail(target, "Dangerous target requires explicit opt-in.");
        }

        if (target.Strategy == DeleteStrategy.RecycleBin)
        {
            return CleanRecycleBin(target, options);
        }

        var policyError = SafePathPolicy.Validate(target.Path);
        if (policyError is not null)
        {
            return Fail(target, $"Blocked by safety policy: {policyError}");
        }

        if (!Directory.Exists(target.Path))
        {
            return new CleanResultItem(target.Id, target.Name, target.Path, 0, 0, true, null);
        }

        if (target.GuardProcess is not null && ProcessGuard.IsRunning(target.GuardProcess))
        {
            return Fail(target, $"{target.GuardProcess} is running. Close it first.");
        }

        long freed = 0;
        int deleted = 0;
        var errors = new List<string>();

        foreach (var entry in EnumerateEntries(target))
        {
            ct.ThrowIfCancellationRequested();

            // Defence in depth: re-check every concrete path right before touching it.
            if (!SafePathPolicy.IsAllowed(entry.FullName))
            {
                errors.Add($"refused: {entry.FullName}");
                _log?.Invoke($"refused by policy: {entry.FullName}");
                continue;
            }

            var size = SizeOf(entry);
            var fileCount = CountFiles(entry);

            if (options.DryRun)
            {
                freed += size;
                deleted += fileCount;
                continue;
            }

            if (DeleteEntry(entry, options))
            {
                freed += size;
                deleted += fileCount;
                _log?.Invoke($"deleted: {entry.FullName} ({size} bytes)");
            }
            else
            {
                errors.Add($"could not delete: {entry.Name}");
            }
        }

        if (target.Strategy == DeleteStrategy.WholeDirectory && !options.DryRun && Directory.Exists(target.Path))
        {
            TryDeleteDirectory(target.Path, ref freed);
        }

        var error = errors.Count == 0 ? null : string.Join("; ", errors.Take(5));
        return new CleanResultItem(target.Id, target.Name, target.Path, freed, deleted, errors.Count == 0, error);
    }

    private CleanResultItem CleanRecycleBin(CleanTarget target, CleanOptions options)
    {
        if (!RecycleBin.IsSupported)
        {
            return Fail(target, "Recycle Bin is only supported on Windows.");
        }

        var drive = Path.GetPathRoot(target.Path) ?? "C:\\";
        var size = RecycleBin.QuerySize(drive);

        if (options.DryRun)
        {
            return new CleanResultItem(target.Id, target.Name, target.Path, size, 0, true, null);
        }

        var ok = RecycleBin.Empty(drive);
        _log?.Invoke($"recycle bin emptied ({drive}): {ok} ({size} bytes)");
        return new CleanResultItem(
            target.Id,
            target.Name,
            target.Path,
            ok ? size : 0,
            0,
            ok,
            ok ? null : "SHEmptyRecycleBin failed.");
    }

    private IEnumerable<FileSystemInfo> EnumerateEntries(CleanTarget target)
    {
        List<FileSystemInfo> entries;
        try
        {
            entries = new DirectoryInfo(target.Path).EnumerateFileSystemInfos("*",
                new EnumerationOptions
                {
                    RecurseSubdirectories = false,
                    IgnoreInaccessible = true,
                    AttributesToSkip = FileAttributes.ReparsePoint | FileAttributes.Offline,
                }).ToList();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            yield break;
        }

        var cutoff = target.OlderThanDays > 0
            ? DateTime.UtcNow.AddDays(-target.OlderThanDays)
            : (DateTime?)null;

        foreach (var entry in entries)
        {
            if (!Matches(target, entry))
            {
                continue;
            }

            if (cutoff is not null && entry.LastWriteTimeUtc > cutoff)
            {
                continue;
            }

            yield return entry;
        }
    }

    internal static bool Matches(CleanTarget target, FileSystemInfo entry)
        => target.Match switch
        {
            PathMatch.All => true,
            PathMatch.Extensions => target.Extensions.Any(e =>
                e.Equals(entry.Extension, StringComparison.OrdinalIgnoreCase)),
            PathMatch.Patterns => target.NamePatterns.Any(p => GlobMatch(entry.Name, p)),
            _ => false,
        };

    /// <summary>Case-insensitive glob supporting <c>*</c> and <c>?</c>.</summary>
    internal static bool GlobMatch(string text, string pattern)
    {
        var regex = "^" + Regex.Escape(pattern).Replace(@"\*", ".*").Replace(@"\?", ".") + "$";
        return Regex.IsMatch(text, regex, RegexOptions.IgnoreCase | RegexOptions.Singleline);
    }

    private static long SizeOf(FileSystemInfo entry)
    {
        try
        {
            return entry switch
            {
                FileInfo file => file.Length,
                DirectoryInfo dir => dir.EnumerateFiles("*", new EnumerationOptions
                {
                    RecurseSubdirectories = true,
                    IgnoreInaccessible = true,
                    AttributesToSkip = FileAttributes.ReparsePoint | FileAttributes.Offline,
                }).Sum(f => f.Length),
                _ => 0,
            };
        }
        catch
        {
            return 0;
        }
    }

    private static int CountFiles(FileSystemInfo entry)
    {
        try
        {
            return entry is FileInfo
                ? 1
                : ((DirectoryInfo)entry).EnumerateFiles("*", new EnumerationOptions
                {
                    RecurseSubdirectories = true,
                    IgnoreInaccessible = true,
                    AttributesToSkip = FileAttributes.ReparsePoint,
                }).Count();
        }
        catch
        {
            return 0;
        }
    }

    private bool DeleteEntry(FileSystemInfo entry, CleanOptions options)
    {
        try
        {
            switch (entry)
            {
                case FileInfo file:
                    ClearReadOnly(file);
                    if (options.UseRecycleBin && OperatingSystem.IsWindows())
                    {
                        SendToRecycleBinFile(file.FullName);
                    }
                    else
                    {
                        file.Delete();
                    }

                    return true;

                case DirectoryInfo dir:
                    if (options.UseRecycleBin && OperatingSystem.IsWindows())
                    {
                        SendToRecycleBinDirectory(dir.FullName);
                    }
                    else
                    {
                        dir.Delete(recursive: true);
                    }

                    return !dir.Exists;
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            _log?.Invoke($"delete failed: {entry.FullName} -> {ex.Message}");
        }

        return false;
    }

    private bool TryDeleteDirectory(string path, ref long freed)
    {
        try
        {
            Directory.Delete(path, recursive: true);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _log?.Invoke($"directory delete failed: {path} -> {ex.Message}");
            return false;
        }
    }

    private static void ClearReadOnly(FileInfo file)
    {
        if ((file.Attributes & FileAttributes.ReadOnly) != 0)
        {
            file.Attributes &= ~FileAttributes.ReadOnly;
        }
    }

    private static void SendToRecycleBinFile(string fullPath)
        => Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(
            fullPath,
            Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs,
            Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);

    private static void SendToRecycleBinDirectory(string fullPath)
        => Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(
            fullPath,
            Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs,
            Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);

    private static CleanResultItem Fail(CleanTarget target, string error)
        => new(target.Id, target.Name, target.Path, 0, 0, false, error);
}
