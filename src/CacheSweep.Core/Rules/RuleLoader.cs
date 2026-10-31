using System.Text.Json;
using System.Text.Json.Serialization;
using CacheSweep.Core.Models;
using CacheSweep.Core.Safety;

namespace CacheSweep.Core.Rules;

/// <summary>
/// A rule file is a list of declarative targets. External JSON can add targets,
/// but <see cref="SafePathPolicy"/> still gate-keeps every path, so a bad rule
/// file degrades to "rejected", never to "deleted something important".
/// </summary>
public static class RuleLoader
{
    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        Converters = { new JsonStringEnumConverter() },
        WriteIndented = true,
    };

    public static IReadOnlyList<CleanTarget> LoadFromJson(string json)
    {
        var doc = JsonSerializer.Deserialize<RuleDocument>(json, JsonOptions)
                  ?? throw new InvalidDataException("Rule document is empty.");

        return Materialize(doc.Targets);
    }

    public static IReadOnlyList<CleanTarget> LoadFromFile(string path)
        => LoadFromJson(File.ReadAllText(path));

    /// <summary>
    /// Parses a rule file, returning an empty list when it is absent. Parse
    /// failures are reported through <paramref name="rejected"/> and treated as
    /// "no extra rules" so a broken file never blocks startup.
    /// </summary>
    public static IReadOnlyList<RuleTarget> LoadFromFileOrNull(
        string? path,
        ICollection<(string Id, string Reason)>? rejected = null)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            return Array.Empty<RuleTarget>();
        }

        try
        {
            var doc = JsonSerializer.Deserialize<RuleDocument>(
                StripBom(File.ReadAllText(path)), JsonOptions);

            if (doc is null)
            {
                rejected?.Add(("(rule file)", "Rule file is empty."));
                return Array.Empty<RuleTarget>();
            }

            return doc.Targets;
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            rejected?.Add(("(rule file)", $"Rule file failed to parse: {ex.Message}"));
            return Array.Empty<RuleTarget>();
        }
    }

    /// <summary>
    /// Expands environment variables and drops targets that fail the safety
    /// policy. Rejected targets are reported through <paramref name="rejected"/>.
    /// </summary>
    public static IReadOnlyList<CleanTarget> Materialize(
        IEnumerable<RuleTarget> rules,
        ICollection<(string Id, string Reason)>? rejected = null)
    {
        var result = new List<CleanTarget>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var rule in rules)
        {
            if (string.IsNullOrWhiteSpace(rule.Id) || string.IsNullOrWhiteSpace(rule.Path))
            {
                rejected?.Add((rule.Id ?? "?", "Rule is missing an id or path."));
                continue;
            }

            if (!seen.Add(rule.Id))
            {
                rejected?.Add((rule.Id, "Duplicate rule id."));
                continue;
            }

            var path = SafePathPolicy.NormalizePath(rule.Path);
            var reason = SafePathPolicy.Validate(path);
            if (reason is not null)
            {
                rejected?.Add((rule.Id, reason));
                continue;
            }

            result.Add(new CleanTarget
            {
                Id = rule.Id,
                Name = rule.Name ?? rule.Id,
                Description = rule.Description ?? string.Empty,
                Path = path,
                Category = rule.Category,
                Risk = rule.Risk,
                Strategy = rule.Strategy,
                Match = rule.Match,
                Extensions = rule.Extensions ?? Array.Empty<string>(),
                NamePatterns = rule.NamePatterns ?? Array.Empty<string>(),
                OlderThanDays = Math.Max(0, rule.OlderThanDays),
                GuardProcess = rule.GuardProcess,
            });
        }

        return result;
    }

    /// <summary>Strips byte-order marks so embedded rule files parse on any platform.</summary>
    public static string StripBom(string text)
        => text.Length > 0 && text[0] == '\uFEFF' ? text[1..] : text;
}

public sealed class RuleDocument
{
    public string? SchemaVersion { get; set; }
    public List<RuleTarget> Targets { get; set; } = new();
}

/// <summary>Wire format of one rule. Nullable so a partial rule can be rejected cleanly.</summary>
public sealed class RuleTarget
{
    public string? Id { get; set; }
    public string? Name { get; set; }
    public string? Description { get; set; }
    public string? Path { get; set; }
    public TargetCategory Category { get; set; }
    public RiskLevel Risk { get; set; } = RiskLevel.Caution;
    public DeleteStrategy Strategy { get; set; } = DeleteStrategy.ContentsOfDirectory;
    public PathMatch Match { get; set; } = PathMatch.All;
    public string[]? Extensions { get; set; }
    public string[]? NamePatterns { get; set; }
    public int OlderThanDays { get; set; }
    public string? GuardProcess { get; set; }
}
