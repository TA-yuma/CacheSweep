namespace CacheSweep.Core.Models;

/// <summary>
/// Risk classification of a cleanup target. Drives confirmation UI and
/// whether the target is deleted permanently or sent to the Recycle Bin.
/// </summary>
public enum RiskLevel
{
    /// <summary>Regenerated automatically, deleting cannot lose user data. Safe for one-click.</summary>
    Safe = 0,

    /// <summary>Regenerable but causes a noticeable first-run cost (re-download, re-login). Confirm recommended.</summary>
    Caution = 1,

    /// <summary>May contain user-visible data. Never included in one-click; explicit per-item confirmation required.</summary>
    Dangerous = 2,
}

/// <summary>Which category a target belongs to, used for grouping in the UI.</summary>
public enum TargetCategory
{
    TempFiles = 0,
    BrowserCache = 1,
    AppCache = 2,
    SystemCache = 3,
    DeveloperCache = 4,
    CrashAndDiagnostics = 5,
    RecycleBin = 6,
}

/// <summary>How a target's path is deleted.</summary>
public enum DeleteStrategy
{
    /// <summary>Delete every entry inside the directory, keep the directory itself.</summary>
    ContentsOfDirectory = 0,

    /// <summary>Delete only entries matching <see cref="CleanTarget.Match"/>.</summary>
    MatchingEntries = 1,

    /// <summary>Delete the directory itself (e.g. old installers). Recreated on demand.</summary>
    WholeDirectory = 2,

    /// <summary>Empty the Recycle Bin through the shell API.</summary>
    RecycleBin = 3,
}

public enum PathMatch
{
    All = 0,

    /// <summary>Only entries whose extension is in <see cref="CleanTarget.Extensions"/>.</summary>
    Extensions = 1,

    /// <summary>Only entries whose name matches one of <see cref="CleanTarget.NamePatterns"/> (glob).</summary>
    Patterns = 2,
}

/// <summary>
/// A single cleanable location declared by a rule. Paths are expanded at rule
/// evaluation time; nothing here is hardcoded to one machine.
/// </summary>
public sealed record CleanTarget
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Description { get; init; }

    /// <summary>Absolute path after environment-variable expansion.</summary>
    public required string Path { get; init; }

    public required TargetCategory Category { get; init; }
    public required RiskLevel Risk { get; init; }

    /// <summary>How the path is deleted.</summary>
    public DeleteStrategy Strategy { get; init; } = DeleteStrategy.ContentsOfDirectory;

    /// <summary>Match policy applied to the top-level entries of <see cref="Path"/>.</summary>
    public PathMatch Match { get; init; } = PathMatch.All;

    /// <summary>Extensions (with leading dot) used when <see cref="Match"/> is <see cref="PathMatch.Extensions"/>.</summary>
    public IReadOnlyList<string> Extensions { get; init; } = Array.Empty<string>();

    /// <summary>Glob patterns used when <see cref="Match"/> is <see cref="PathMatch.Patterns"/>.</summary>
    public IReadOnlyList<string> NamePatterns { get; init; } = Array.Empty<string>();

    /// <summary>Skip entries modified more recently than this many days (guards live files). 0 = no age filter.</summary>
    public int OlderThanDays { get; init; }

    /// <summary>Name of a process that, when running, means we should not touch this target.</summary>
    public string? GuardProcess { get; init; }

    // ---- Measured at scan time (not part of rule identity) ----

    public long MeasuredBytes { get; set; }
    public int FileCount { get; set; }

    /// <summary>"ok", "missing", "blocked" (policy), or "in-use" (process running).</summary>
    public string Status { get; set; } = "ok";

    /// <summary>
    /// User preference: false puts the target on the ignore list. A disabled
    /// target is still listed but never measured or cleaned.
    /// </summary>
    public bool Enabled { get; set; } = true;
}
