namespace CacheSweep.Core.Rules;

/// <summary>
/// Automatic cleanup settings.
///
/// The scope is deliberately narrow: only regenerable cache is eligible
/// (images, video, thumbnails, shader caches, temp files, crash dumps). The
/// Recycle Bin, developer package stores and anything classified Dangerous are
/// never touched automatically, no matter how the schedule is configured.
/// </summary>
public sealed class AutoCleanSettings
{
    /// <summary>Master switch.</summary>
    public bool Enabled { get; set; }

    /// <summary>"daily" | "weekly" | "monthly".</summary>
    public string Frequency { get; set; } = "weekly";

    /// <summary>Local time of day to run, "HH:mm".</summary>
    public string TimeOfDay { get; set; } = "03:00";

    /// <summary>UTC timestamp of the last successful run, or null.</summary>
    public DateTimeOffset? LastRunUtc { get; set; }

    /// <summary>Bytes freed by the last run.</summary>
    public long LastRunFreedBytes { get; set; }

    /// <summary>
    /// When true, files go to the Recycle Bin so an accidental delete can be
    /// undone. Defaults to true: automatic deletions should be reversible.
    /// </summary>
    public bool UseRecycleBin { get; set; } = true;
}

/// <summary>
/// The set of rule ids eligible for automatic cleanup.
///
/// This is an explicit allow-list rather than "everything except X", so a new
/// rule added later can never be swept up by a background job without a
/// deliberate decision to include it.
/// </summary>
public static class AutoCleanScope
{
    /// <summary>
    /// Rule ids and plugin rule ids that are pure cache. Anything that can hold
    /// user-visible data (Recycle Bin, pnpm store, chat media) is absent.
    /// </summary>
    public static readonly IReadOnlySet<string> EligibleIds = new HashSet<string>(
        StringComparer.OrdinalIgnoreCase)
    {
        // Core cache rules
        // Only folders writable without elevation. Windows Update cache and
        // CBS logs live under %WINDIR% and need admin rights, so they are left
        // to the manual flow; a background job must not silently fail on them.
        "user-temp",
        "crash-dumps",
        "wer-reports",
        "d3d-shader-cache",

        // Browser plugin: caches only, never history/bookmarks/cookies
        "plugin-browser-edge-cache",
        "plugin-browser-edge-media",
        "plugin-browser-edge-gpu",
        "plugin-browser-chrome-cache",
        "plugin-browser-chrome-media",
        "plugin-browser-brave-cache",

        // Game / GPU shader caches
        "plugin-game-nvidia",
        "plugin-game-d3d",

        // Developer compile caches (regenerable, not package stores)
        "plugin-dev-vscode",

        // Chat app runtime caches (not the media folders)
        "plugin-wechat-appdata",
        "plugin-qq-appdata",
    };

    public static bool IsEligible(string ruleId) => EligibleIds.Contains(ruleId);
}

/// <summary>Outcome of one automatic cleanup run, for logging and the UI.</summary>
public sealed class AutoCleanRecord
{
    public DateTimeOffset RanAt { get; set; }
    public long FreedBytes { get; set; }
    public int DeletedFiles { get; set; }
    public int Failures { get; set; }
    public bool Skipped { get; set; }
    public string? Reason { get; set; }
}
