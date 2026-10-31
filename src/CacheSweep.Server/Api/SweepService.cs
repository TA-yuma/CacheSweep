using System.Text.Json;
using CacheSweep.Core.Cleaning;
using CacheSweep.Core.Models;
using CacheSweep.Core.Rules;
using CacheSweep.Core.Scanning;

namespace CacheSweep.Server.Api;

/// <summary>
/// Owns the rule set, user preferences and the last scan. The HTTP surface only
/// accepts target ids — never paths — so a client cannot widen what may be
/// deleted beyond the rule set that the safety policy already vetted.
/// </summary>
public sealed class SweepService
{
    private readonly object _gate = new();
    private readonly List<string> _auditLog = new();
    private readonly string _logDirectory;
    private readonly string _preferencesPath;

    private UserPreferences _preferences;
    private IReadOnlyList<CleanTarget>? _targets;
    private ScanReport? _lastReport;
    private readonly List<(string Id, string Reason)> _rejectedRules = new();

    public SweepService(IConfiguration config)
    {
        _logDirectory = config["LogDirectory"]
                        ?? Path.Combine(
                            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                            "CacheSweep", "logs");

        _preferencesPath = config["PreferencesPath"] ?? UserPreferences.DefaultPath;
        Directory.CreateDirectory(_logDirectory);
        _preferences = UserPreferences.Load(_preferencesPath);
    }

    public IReadOnlyList<(string Id, string Reason)> RejectedRules
    {
        get
        {
            lock (_gate)
            {
                return _rejectedRules.ToArray();
            }
        }
    }

    public UserPreferences Preferences
    {
        get
        {
            lock (_gate)
            {
                return _preferences;
            }
        }
    }

    private IReadOnlyList<CleanTarget> Targets
    {
        get
        {
            lock (_gate)
            {
                return _targets ??= LoadTargets();
            }
        }
    }

    private IReadOnlyList<CleanTarget> LoadTargets()
    {
        var rejected = new List<(string Id, string Reason)>();
        var targets = BuiltInRules.Load(_preferences, extraRuleFile: null, rejected);

        lock (_gate)
        {
            _rejectedRules.Clear();
            _rejectedRules.AddRange(rejected);
        }

        foreach (var r in rejected)
        {
            Log($"rule rejected: {r.Id} -> {r.Reason}");
        }

        return targets;
    }

    public IReadOnlyList<CleanTarget> AllTargets => Targets;

    public ScanReport Scan(CancellationToken ct)
    {
        var report = new Scanner(Targets).Scan(ct);
        lock (_gate)
        {
            _lastReport = report;
        }

        Log($"scan: {report.Items.Count} targets, {report.TotalBytes} bytes, {report.ScanDurationMs} ms");
        return report;
    }

    public CleanResult Clean(
        CleanRequest request,
        CancellationToken ct,
        Action<CleanProgress>? onProgress = null)
    {
        var options = new CleanOptions
        {
            DryRun = request.DryRun,
            UseRecycleBin = request.UseRecycleBin,
            AllowDangerous = request.AllowDangerous,
        };

        var result = new Cleaner(Targets, Log).Clean(request.TargetIds, options, ct, onProgress);
        Log($"clean (dryRun={request.DryRun}): ids={string.Join(',', request.TargetIds)} "
            + $"freed={result.TotalFreedBytes} failures={result.Failures}");

        if (!request.DryRun)
        {
            lock (_gate)
            {
                _lastReport = null; // sizes are stale after a deletion
            }
        }

        return result;
    }

    /* ---------------- blacklist / whitelist ---------------- */

    /// <summary>
    /// Enables or disables targets. Disabled targets are the user's ignore list
    /// (blacklist); everything enabled is what gets scanned and cleaned.
    /// </summary>
    public IReadOnlyList<CleanTarget> SetTargetEnabled(IEnumerable<string> ids, bool enabled)
    {
        var set = ids.Where(id => !string.IsNullOrWhiteSpace(id))
                     .Select(id => id.Trim())
                     .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (set.Count == 0)
        {
            return Targets;
        }

        lock (_gate)
        {
            var known = Targets.Select(t => t.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var id in set.Where(id => !known.Contains(id)))
            {
                Log($"toggle ignored: unknown id {id}");
            }

            var disabled = _preferences.DisabledTargetIds.ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (enabled)
            {
                foreach (var id in set)
                {
                    disabled.Remove(id);
                }
            }
            else
            {
                foreach (var id in set.Where(id => known.Contains(id)))
                {
                    disabled.Add(id);
                }
            }

            _preferences.DisabledTargetIds = disabled.OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToList();
            PersistPreferences();

            // The cached rule list carries the old Enabled flags; drop it so the
            // next read (and the next scan) reflects the new blacklist.
            _targets = null;
            _lastReport = null;

            Log($"targets {(enabled ? "enabled" : "ignored")}: {string.Join(',', set.OrderBy(x => x))}");
        }

        return Targets;
    }

    /// <summary>
    /// Adds a user-defined cache location. The safety policy decides whether it
    /// is allowed; a rejected path is reported, not stored.
    /// </summary>
    public (CleanTarget? Target, string? Error) AddCustomTarget(RuleTarget rule)
    {
        if (string.IsNullOrWhiteSpace(rule.Path))
        {
            return (null, "路径不能为空。");
        }

        var pathError = CacheSweep.Core.Safety.SafePathPolicy.Validate(rule.Path);
        if (pathError is not null)
        {
            return (null, pathError);
        }

        lock (_gate)
        {
            var id = rule.Id?.Trim();
            if (string.IsNullOrWhiteSpace(id))
            {
                id = "custom-" + Convert.ToHexString(
                    System.Security.Cryptography.SHA256.HashData(
                        System.Text.Encoding.UTF8.GetBytes(
                            CacheSweep.Core.Safety.SafePathPolicy.NormalizePath(rule.Path))))
                    [..10].ToLowerInvariant();
            }

            if (Targets.Any(t => t.Id.Equals(id, StringComparison.OrdinalIgnoreCase)))
            {
                return (null, $"规则 ID「{id}」已存在。");
            }

            rule.Id = id;
            rule.Name ??= id;
            rule.Description ??= "用户自定义的缓存位置";

            _preferences.CustomTargets.Add(rule);
            PersistPreferences();
            _targets = null; // force reload with the new rule

            var created = Targets.FirstOrDefault(t => t.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
            if (created is null)
            {
                return (null, "规则未通过安全策略校验。");
            }

            Log($"custom target added: {id} -> {created.Path}");
            return (created, null);
        }
    }

    public bool RemoveCustomTarget(string id)
    {
        lock (_gate)
        {
            var removed = _preferences.CustomTargets.RemoveAll(
                r => string.Equals(r.Id, id, StringComparison.OrdinalIgnoreCase)) > 0;

            if (removed)
            {
                PersistPreferences();
                _targets = null;
                Log($"custom target removed: {id}");
            }

            return removed;
        }
    }

    /// <summary>Ids the user has put on the ignore list.</summary>
    public IReadOnlyList<string> GetIgnoredIds()
    {
        lock (_gate)
        {
            return _preferences.DisabledTargetIds.ToArray();
        }
    }

    /* ---------------- disk inventory ---------------- */

    public IReadOnlyList<InstalledApp> GetInstalledApps(CancellationToken ct)
        => new DiskInventory().GetInstalledApps(ct);

    public IReadOnlyList<LargeFile> GetLargeFiles(string? root, long minBytes, int take, CancellationToken ct)
    {
        var drive = string.IsNullOrWhiteSpace(root)
            ? Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)) ?? "C:\\"
            : root;

        // Only whole-drive roots are accepted: walking an arbitrary user path
        // would let the UI enumerate unrelated parts of the file system.
        if (!drive.EndsWith('\\') || drive.Length > 3)
        {
            var pathError = CacheSweep.Core.Safety.SafePathPolicy.Validate(drive);
            if (pathError is not null)
            {
                throw new ArgumentException(pathError);
            }
        }

        return new DiskInventory().FindLargeFiles(
            drive,
            Math.Clamp(minBytes, 1L << 20, 64L << 30),
            Math.Clamp(take, 1, 500),
            ct);
    }

    public IReadOnlyList<FolderUsage> GetFolderUsage(string driveRoot, CancellationToken ct)
    {
        if (!driveRoot.EndsWith('\\') || driveRoot.Length > 3)
        {
            throw new ArgumentException("只支持整盘根目录，例如 C:\\");
        }

        return new DiskInventory().GetFolderUsage(driveRoot, take: 25, ct);
    }

    public static (long FreeBytes, long TotalBytes) GetDriveSpace(string driveRoot)
        => DiskInventory.GetDriveSpace(driveRoot);

    /* ---------------- preferences + audit ---------------- */

    public void SetTheme(string theme)
    {
        var normalized = theme.ToLowerInvariant() switch
        {
            "light" => "light",
            "transparent" => "transparent",
            _ => "dark",
        };

        lock (_gate)
        {
            if (_preferences.Theme == normalized)
            {
                return;
            }

            _preferences.Theme = normalized;
            PersistPreferences();
        }
    }

    public IReadOnlyList<string> GetAuditLog()
    {
        lock (_gate)
        {
            return _auditLog.ToArray();
        }
    }

    private void PersistPreferences()
    {
        try
        {
            _preferences.Save(_preferencesPath);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log($"failed to save preferences: {ex.Message}");
        }
    }

    private void Log(string message)
    {
        var line = $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss.fff zzz}  {message}";
        lock (_gate)
        {
            _auditLog.Add(line);
            if (_auditLog.Count > 2000)
            {
                _auditLog.RemoveRange(0, _auditLog.Count - 2000);
            }
        }

        try
        {
            File.AppendAllText(
                Path.Combine(_logDirectory, $"cachesweep-{DateTime.Now:yyyy-MM-dd}.log"),
                line + Environment.NewLine);
        }
        catch (IOException)
        {
            // Logging must never break the operation.
        }
    }
}

public sealed record CleanRequest(
    IReadOnlyList<string> TargetIds,
    bool DryRun = true,
    bool UseRecycleBin = true,
    bool AllowDangerous = false);

public sealed record ToggleRequest(IReadOnlyList<string> TargetIds, bool Enabled);

public sealed record ThemeRequest(string Theme);
