using System.Text.Json;
using CacheSweep.Core.Models;

namespace CacheSweep.Core.Rules;

/// <summary>
/// Builds the effective rule set: built-ins, plus targets from the legacy rule
/// file, plus targets the user added through the UI, minus anything the user
/// chose to ignore.
///
/// A user rule may add targets but never removes or redefines a built-in one,
/// and every path still has to pass <see cref="Safety.SafePathPolicy"/>.
/// </summary>
public static class BuiltInRules
{
    private const string ResourceName = "CacheSweep.Core.Rules.builtin-rules.json";

    private static readonly Lazy<string> RawJson = new(() =>
    {
        var asm = typeof(BuiltInRules).Assembly;
        using var stream = asm.GetManifestResourceStream(ResourceName)
                           ?? throw new InvalidOperationException($"Missing embedded resource {ResourceName}.");
        using var reader = new StreamReader(stream);
        return RuleLoader.StripBom(reader.ReadToEnd());
    });

    public static string Json => RawJson.Value;

    /// <summary>Built-in targets only, ignoring all user configuration.</summary>
    public static IReadOnlyList<CleanTarget> LoadBuiltIn()
        => RuleLoader.LoadFromJson(RawJson.Value);

    /// <summary>
    /// Legacy entry point retained for callers that only know about a rule file.
    /// </summary>
    public static IReadOnlyList<CleanTarget> Load(
        string? userRuleFile = null,
        ICollection<(string Id, string Reason)>? rejected = null)
    {
        return Load(RuleLoader.LoadFromFileOrNull(userRuleFile, rejected), rejected, null);
    }

    /// <summary>
    /// Effective rule set for the app.
    /// </summary>
    /// <param name="preferences">User ignore list and custom targets; may be null.</param>
    /// <param name="extraRuleFile">Optional legacy JSON rule file.</param>
    /// <param name="rejected">Collects rules dropped by the safety policy.</param>
    public static IReadOnlyList<CleanTarget> Load(
        UserPreferences? preferences,
        string? extraRuleFile = null,
        ICollection<(string Id, string Reason)>? rejected = null)
    {
        var fromFile = RuleLoader.LoadFromFileOrNull(extraRuleFile, rejected);
        return Load(fromFile, rejected, preferences);
    }

    private static IReadOnlyList<CleanTarget> Load(
        IReadOnlyList<RuleTarget> userRules,
        ICollection<(string Id, string Reason)>? rejected,
        UserPreferences? preferences)
    {
        var builtIn = RuleLoader.LoadFromJson(RawJson.Value);
        var knownIds = builtIn
            .Select(t => t.Id)
            .Concat(userRules.Where(r => r.Id is not null).Select(r => r.Id!))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var extras = new List<RuleTarget>(userRules);
        if (preferences is not null)
        {
            foreach (var custom in preferences.CustomTargets)
            {
                if (custom.Id is not null && !knownIds.Add(custom.Id))
                {
                    rejected?.Add((custom.Id, "Cannot override an existing rule."));
                    continue;
                }

                extras.Add(custom);
            }
        }

        var materialized = RuleLoader.Materialize(extras, rejected);
        var all = builtIn.Concat(materialized).ToList();

        if (preferences is null || preferences.DisabledTargetIds.Count == 0)
        {
            return all;
        }

        var ignored = preferences.DisabledTargetIds.ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var target in all)
        {
            if (ignored.Contains(target.Id))
            {
                target.Enabled = false;
            }
        }

        return all;
    }
}
