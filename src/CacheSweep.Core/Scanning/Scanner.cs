using System.Diagnostics;
using CacheSweep.Core.Models;

namespace CacheSweep.Core.Scanning;

/// <summary>
/// Walks a directory and sums file sizes. Tolerates access-denied paths and
/// reparse points (junctions must never be followed or we walk out of the tree).
/// </summary>
public static class DirectoryMeasurer
{
    private static readonly EnumerationOptions Options = new()
    {
        RecurseSubdirectories = true,
        IgnoreInaccessible = true,
        AttributesToSkip = FileAttributes.ReparsePoint | FileAttributes.Offline,
        ReturnSpecialDirectories = false,
    };

    public static (long Bytes, int Files) Measure(string path, CancellationToken ct = default)
    {
        if (!Directory.Exists(path))
        {
            return (0, 0);
        }

        long bytes = 0;
        int files = 0;
        try
        {
            foreach (var entry in new DirectoryInfo(path).EnumerateFiles("*", Options))
            {
                if ((files & 0x3FF) == 0)
                {
                    ct.ThrowIfCancellationRequested();
                }

                try
                {
                    bytes += entry.Length;
                    files++;
                }
                catch (IOException)
                {
                    // File vanished between enumeration and access; skip it.
                }
                catch (UnauthorizedAccessException)
                {
                }
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
        }

        return (bytes, files);
    }
}

/// <summary>
/// Runs the rule set against the machine and produces a <see cref="ScanReport"/>.
/// </summary>
public sealed class Scanner
{
    private readonly IReadOnlyList<CleanTarget> _targets;

    public Scanner(IReadOnlyList<CleanTarget> targets)
    {
        _targets = targets;
    }

    public ScanReport Scan(CancellationToken ct = default)
    {
        var sw = Stopwatch.StartNew();
        var items = new List<ScanResultItem>(_targets.Count);

        foreach (var target in _targets)
        {
            ct.ThrowIfCancellationRequested();

            target.MeasuredBytes = 0;
            target.FileCount = 0;
            target.Status = "ok";

            if (!Directory.Exists(target.Path))
            {
                target.Status = "missing";
            }
            else if (!target.Enabled)
            {
                // Ignored by the user: listed for transparency, never measured.
                target.Status = "ignored";
            }
            else
            {
                // Always measure: an in-use target still occupies space and the
                // user should see it. The clean step refuses it while guarded.
                var (bytes, files) = DirectoryMeasurer.Measure(target.Path, ct);
                target.MeasuredBytes = bytes;
                target.FileCount = files;

                if (target.GuardProcess is not null && ProcessGuard.IsRunning(target.GuardProcess))
                {
                    target.Status = "in-use";
                }
            }

            items.Add(new ScanResultItem(
                target.Id,
                target.Name,
                target.Description,
                target.Path,
                target.Category,
                target.Risk,
                target.Strategy,
                target.MeasuredBytes,
                target.FileCount,
                target.Status));
        }

        sw.Stop();

        return new ScanReport
        {
            MachineName = Environment.MachineName,
            OsVersion = Environment.OSVersion.VersionString,
            ScannedAt = DateTimeOffset.Now,
            ScanDurationMs = sw.ElapsedMilliseconds,
            Items = items,
        };
    }
}

public static class ProcessGuard
{
    public static bool IsRunning(string processName)
    {
        try
        {
            return Process.GetProcessesByName(
                    processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                        ? processName[..^4]
                        : processName)
                .Length > 0;
        }
        catch
        {
            return false;
        }
    }
}
