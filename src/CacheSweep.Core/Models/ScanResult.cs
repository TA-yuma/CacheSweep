namespace CacheSweep.Core.Models;

/// <summary>Result of one scan over one target.</summary>
public sealed record ScanResultItem(
    string Id,
    string Name,
    string Description,
    string Path,
    TargetCategory Category,
    RiskLevel Risk,
    DeleteStrategy Strategy,
    long Bytes,
    int FileCount,
    string Status);

/// <summary>Aggregated scan report returned to the UI.</summary>
public sealed record ScanReport
{
    public required string MachineName { get; init; }
    public required string OsVersion { get; init; }
    public required DateTimeOffset ScannedAt { get; init; }
    public required long ScanDurationMs { get; init; }
    public required IReadOnlyList<ScanResultItem> Items { get; init; }

    public long TotalBytes => Items.Sum(i => i.Bytes);
    public long SafeBytes => Items.Where(i => i.Risk == RiskLevel.Safe).Sum(i => i.Bytes);
    public long CautionBytes => Items.Where(i => i.Risk == RiskLevel.Caution).Sum(i => i.Bytes);
    public long DangerousBytes => Items.Where(i => i.Risk == RiskLevel.Dangerous).Sum(i => i.Bytes);
}

/// <summary>Outcome of deleting a single target.</summary>
public sealed record CleanResultItem(
    string Id,
    string Name,
    string Path,
    long FreedBytes,
    int DeletedFiles,
    bool Success,
    string? Error);

/// <summary>Outcome of a clean operation (either a dry-run or a real run).</summary>
public sealed record CleanResult
{
    public required bool DryRun { get; init; }
    public required DateTimeOffset StartedAt { get; init; }
    public required long DurationMs { get; init; }
    public required IReadOnlyList<CleanResultItem> Items { get; init; }

    public long TotalFreedBytes => Items.Where(i => i.Success).Sum(i => i.FreedBytes);
    public int TotalDeletedFiles => Items.Where(i => i.Success).Sum(i => i.DeletedFiles);
    public int Failures => Items.Count(i => !i.Success);
}

/// <summary>
/// One progress tick during a clean run. Reported after each target finishes so
/// a UI can show a determinate bar rather than an indeterminate spinner.
/// </summary>
public sealed record CleanProgress(
    int Index,
    int Total,
    int TargetCount,
    CleanResultItem Item,
    long FreedBytesSoFar,
    int FilesSoFar,
    int FailuresSoFar)
{
    /// <summary>0–100, rounded down so the bar never claims completion early.</summary>
    public int Percent => Total <= 0 ? 0 : Math.Min(100, Index * 100 / Total);

    public bool IsLast => Index >= Total;
}
