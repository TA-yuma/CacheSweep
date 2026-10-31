using CacheSweep.Core.Cleaning;
using CacheSweep.Core.Models;
using CacheSweep.Core.Rules;

namespace CacheSweep.Core.Automation;

/// <summary>
/// Decides when an automatic cleanup is due and performs it against the
/// cache-only rule set.
///
/// Schedule semantics are deliberately forgiving: the app only runs while the
/// user is logged in, so "due" means "the scheduled moment has passed since the
/// last run", not "fire at exactly this second". Missed runs catch up on the
/// next tick rather than being skipped.
/// </summary>
public sealed class AutoCleanScheduler
{
    private readonly Func<IReadOnlyList<CleanTarget>> _targets;
    private readonly Action<string>? _log;

    public AutoCleanScheduler(Func<IReadOnlyList<CleanTarget>> targets, Action<string>? log = null)
    {
        _targets = targets;
        _log = log;
    }

    /// <summary>
    /// True when a run is due now. Pure function of the settings and the clock,
    /// so it can be unit-tested.
    /// </summary>
    public static bool IsDue(AutoCleanSettings settings, DateTimeOffset now)
    {
        if (!settings.Enabled)
        {
            return false;
        }

        if (!TryParseTime(settings.TimeOfDay, out var hour, out var minute))
        {
            hour = 3;
            minute = 0;
        }

        var scheduledToday = new DateTimeOffset(
            now.Year, now.Month, now.Day, hour, minute, 0, now.Offset);

        var last = settings.LastRunUtc;
        if (last is null)
        {
            // Never run: wait for the next scheduled moment rather than firing
            // the instant the user flips the switch.
            return now >= scheduledToday;
        }

        var lastLocal = last.Value.ToOffset(now.Offset);

        return settings.Frequency.ToLowerInvariant() switch
        {
            "daily" => HasPassedDaily(scheduledToday, lastLocal, now),
            "monthly" => HasPassedMonthly(scheduledToday, lastLocal, now),
            _ => HasPassedWeekly(scheduledToday, lastLocal, now),
        };
    }

    private static bool HasPassedDaily(DateTimeOffset scheduledToday, DateTimeOffset last, DateTimeOffset now)
    {
        // Either today's slot has passed and we have not run since it, or the
        // last run was before yesterday (a missed day).
        var slot = now >= scheduledToday ? scheduledToday : scheduledToday.AddDays(-1);
        return last < slot;
    }

    private static bool HasPassedWeekly(DateTimeOffset scheduledToday, DateTimeOffset last, DateTimeOffset now)
    {
        var slot = now >= scheduledToday ? scheduledToday : scheduledToday.AddDays(-1);
        return last < slot && (now - last) >= TimeSpan.FromDays(6);
    }

    private static bool HasPassedMonthly(DateTimeOffset scheduledToday, DateTimeOffset last, DateTimeOffset now)
    {
        var slot = now >= scheduledToday ? scheduledToday : scheduledToday.AddDays(-1);
        return last < slot && (now - last) >= TimeSpan.FromDays(27);
    }

    private static bool TryParseTime(string? value, out int hour, out int minute)
    {
        hour = 0;
        minute = 0;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var parts = value.Split(':');
        return parts.Length == 2
               && int.TryParse(parts[0], out hour) && hour is >= 0 and < 24
               && int.TryParse(parts[1], out minute) && minute is >= 0 and < 60;
    }

    /// <summary>
    /// Runs one automatic cleanup, restricted to cache-only rules.
    /// Returns null when nothing was due.
    /// </summary>
    public AutoCleanRecord? RunIfDue(AutoCleanSettings settings, DateTimeOffset now)
    {
        if (!IsDue(settings, now))
        {
            return null;
        }

        return Run(settings, now);
    }

    /// <summary>Runs regardless of schedule (used by "run now").</summary>
    public AutoCleanRecord Run(AutoCleanSettings settings, DateTimeOffset now)
    {
        var eligible = _targets()
            .Where(t => t.Enabled && AutoCleanScope.IsEligible(t.Id))
            // Never auto-delete anything risky, whatever a rule file says.
            .Where(t => t.Risk != RiskLevel.Dangerous)
            .ToList();

        if (eligible.Count == 0)
        {
            _log?.Invoke("auto-clean: no eligible cache rules (are plugins installed?)");
            return new AutoCleanRecord
            {
                RanAt = now,
                Skipped = true,
                Reason = "No eligible cache rules.",
            };
        }

        var options = new CleanOptions
        {
            DryRun = false,
            UseRecycleBin = settings.UseRecycleBin,
            AllowDangerous = false,
        };

        var result = new Cleaner(_targets(), _log)
            .Clean(eligible.Select(t => t.Id), options);

        _log?.Invoke(
            $"auto-clean: {result.TotalDeletedFiles} files, {result.TotalFreedBytes} bytes, " +
            $"{result.Failures} failures");

        // Log why each target failed: silent failures in a background job are
        // impossible to diagnose after the fact.
        foreach (var item in result.Items.Where(i => !i.Success))
        {
            _log?.Invoke($"auto-clean failed [{item.Id}] {item.Path}: {item.Error}");
        }

        return new AutoCleanRecord
        {
            RanAt = now,
            FreedBytes = result.TotalFreedBytes,
            DeletedFiles = result.TotalDeletedFiles,
            Failures = result.Failures,
        };
    }

    /// <summary>Rules that an automatic run would touch, for the settings preview.</summary>
    public IReadOnlyList<CleanTarget> EligibleTargets()
        => _targets()
            .Where(t => AutoCleanScope.IsEligible(t.Id) && t.Risk != RiskLevel.Dangerous)
            .ToList();
}
