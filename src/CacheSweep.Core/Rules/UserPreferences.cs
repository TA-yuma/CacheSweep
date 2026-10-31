using System.Text.Json;
using System.Text.Json.Serialization;
using CacheSweep.Core.Models;

namespace CacheSweep.Core.Rules;

/// <summary>
/// Persisted user preferences: which targets are ignored (blacklist) and which
/// extra custom targets the user added.
///
/// Stored at %APPDATA%\CacheSweep\preferences.json. The file is advisory: the
/// safety policy still gate-keeps custom paths, so a hand-edited file cannot
/// widen what may be deleted.
/// </summary>
public sealed class UserPreferences
{
    /// <summary>Ids of built-in targets the user chose to ignore.</summary>
    public List<string> DisabledTargetIds { get; set; } = new();

    /// <summary>Extra cache locations the user added through the UI.</summary>
    public List<RuleTarget> CustomTargets { get; set; } = new();

    /// <summary>Last selected theme: "dark" | "light" | "transparent".</summary>
    public string Theme { get; set; } = "dark";

    /// <summary>UI language: "zh" | "en" | "ru".</summary>
    public string Language { get; set; } = "zh";

    /// <summary>
    /// Plugins the user installed. Uninstalled plugins contribute no rules, so
    /// their folders are never scanned.
    /// </summary>
    public List<string> InstalledPlugins { get; set; } = new();

    /// <summary>Installed plugins the user temporarily disabled.</summary>
    public List<string> DisabledPlugins { get; set; } = new();

    /// <summary>Automatic cleanup configuration.</summary>
    public AutoCleanSettings AutoClean { get; set; } = new();

    /// <summary>Launch CacheSweep in the tray at Windows sign-in.</summary>
    public bool StartWithWindows { get; set; }

    /// <summary>When starting with Windows, do not pop the window open.</summary>
    public bool StartMinimized { get; set; } = true;

    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string DefaultPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "CacheSweep", "preferences.json");

    public static UserPreferences Load(string? path = null)
    {
        path ??= DefaultPath;
        if (!File.Exists(path))
        {
            return new UserPreferences();
        }

        try
        {
            var text = File.ReadAllText(path);
            return JsonSerializer.Deserialize<UserPreferences>(RuleLoader.StripBom(text), Options)
                   ?? new UserPreferences();
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            // A corrupt preference file must not stop the app; start fresh.
            return new UserPreferences();
        }
    }

    public void Save(string? path = null)
    {
        path ??= DefaultPath;
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }

        File.WriteAllText(path, JsonSerializer.Serialize(this, Options));
    }
}
