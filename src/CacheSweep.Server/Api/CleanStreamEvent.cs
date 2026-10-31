namespace CacheSweep.Server.Api;

/// <summary>
/// One server-sent event during a streaming clean.
///
/// Two kinds are emitted:
///   "progress"  after each target finishes
///   "done"      once, with the full result attached
///
/// The client renders a determinate progress bar from Progress events, then
/// switches to the result summary on Done.
/// </summary>
public sealed class CleanStreamEvent
{
    public required string Kind { get; init; }

    public bool DryRun { get; init; }

    /// <summary>0–100.</summary>
    public int Percent { get; init; }

    /// <summary>1-based index of the target just finished.</summary>
    public int Index { get; init; }

    /// <summary>Total targets in this run.</summary>
    public int Total { get; init; }

    /// <summary>Bytes freed so far (or would be freed, in a dry run).</summary>
    public long FreedBytes { get; init; }

    /// <summary>Files handled so far.</summary>
    public int DeletedFiles { get; init; }

    /// <summary>Targets that failed so far.</summary>
    public int Failures { get; init; }

    /// <summary>Name of the target just finished, for the "now cleaning" line.</summary>
    public string? CurrentName { get; init; }

    public bool? CurrentSuccess { get; init; }

    public long? CurrentBytes { get; init; }

    public string? CurrentError { get; init; }

    public long? DurationMs { get; init; }

    /// <summary>Full result, only present on the "done" event.</summary>
    public object? Result { get; init; }
}
