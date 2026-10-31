using System.Text.Json;
using System.Text.Json.Serialization;
using CacheSweep.Core.Models;
using CacheSweep.Core.Rules;
using CacheSweep.Core.Safety;

namespace CacheSweep.Core.Plugins;

/// <summary>
/// A cleanup plugin: a bundle of rules that can be installed and uninstalled
/// independently. Uninstalled plugins contribute no rules, so their folders are
/// never scanned and cost nothing.
/// </summary>
public sealed record PluginDescriptor
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Description { get; init; }

    /// <summary>Emoji or single character shown as the plugin glyph.</summary>
    public string Icon { get; init; } = "🧩";

    /// <summary>Process that must be running for the plugin to matter, if any.</summary>
    public string? DetectProcess { get; init; }

    /// <summary>Folder whose existence implies the app is installed.</summary>
    public string? DetectPath { get; init; }

    /// <summary>Rules this plugin contributes once installed.</summary>
    public IReadOnlyList<RuleTarget> Rules { get; init; } = Array.Empty<RuleTarget>();
}

/// <summary>
/// Built-in plugin catalogue. Each plugin is just data: the safety policy still
/// vets every path at load time, so a plugin cannot widen the delete surface.
/// </summary>
public static class PluginCatalog
{
    private const string JsonOptionsComment =
        "Rules use the same schema as builtin-rules.json.";

    public static IReadOnlyList<PluginDescriptor> All { get; } = Build();

    public static PluginDescriptor? Find(string id)
        => All.FirstOrDefault(p => p.Id.Equals(id, StringComparison.OrdinalIgnoreCase));

    private static List<PluginDescriptor> Build()
    {
        return new List<PluginDescriptor>
        {
            new()
            {
                Id = "browser",
                Name = "浏览器清理",
                Description = "Edge、Chrome、Brave 的网页图片与视频缓存，以及 GPU 渲染缓存",
                Icon = "🌐",
                DetectProcess = "msedge",
                Rules = new[]
                {
                    Rule("plugin-browser-edge-cache", "Edge 图片与视频缓存",
                        "网页资源缓存。不会删除书签、密码、历史记录",
                        @"%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Cache",
                        TargetCategory.BrowserCache, RiskLevel.Caution, "msedge"),
                    Rule("plugin-browser-edge-media", "Edge 媒体缓存",
                        "视频与音频流缓存，删后需要重新缓冲",
                        @"%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Media Cache",
                        TargetCategory.BrowserCache, RiskLevel.Caution, "msedge"),
                    Rule("plugin-browser-edge-gpu", "Edge GPU 缓存",
                        "浏览器 GPU 渲染缓存",
                        @"%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\GPUCache",
                        TargetCategory.BrowserCache, RiskLevel.Caution, "msedge"),
                    Rule("plugin-browser-chrome-cache", "Chrome 图片与视频缓存",
                        "网页资源缓存。不会删除书签、密码、历史记录",
                        @"%LOCALAPPDATA%\Google\Chrome\User Data\Default\Cache",
                        TargetCategory.BrowserCache, RiskLevel.Caution, "chrome"),
                    Rule("plugin-browser-chrome-media", "Chrome 媒体缓存",
                        "视频与音频流缓存",
                        @"%LOCALAPPDATA%\Google\Chrome\User Data\Default\Media Cache",
                        TargetCategory.BrowserCache, RiskLevel.Caution, "chrome"),
                    Rule("plugin-browser-brave-cache", "Brave 图片与视频缓存",
                        "网页资源缓存，不影响书签与密码",
                        @"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data\Default\Cache",
                        TargetCategory.BrowserCache, RiskLevel.Caution, "brave"),
                },
            },
            new()
            {
                Id = "wechat",
                Name = "微信清理",
                Description = "微信的图片、视频与文件缓存。不会删除聊天记录本身",
                Icon = "💬",
                DetectPath = @"%USERPROFILE%\Documents\WeChat Files",
                Rules = new[]
                {
                    Rule("plugin-wechat-images", "微信图片缓存",
                        "聊天中预览过的图片副本，原件仍在聊天记录里",
                        @"%USERPROFILE%\Documents\WeChat Files",
                        TargetCategory.AppCache, RiskLevel.Dangerous, null,
                        DeleteStrategy.MatchingEntries, PathMatch.Patterns,
                        null, new[] { "FileStorage", "Image", "Video", "Emoji" }),
                    Rule("plugin-wechat-appdata", "微信运行缓存",
                        "微信客户端的运行缓存与日志",
                        @"%APPDATA%\Tencent\WeChat",
                        TargetCategory.AppCache, RiskLevel.Caution, "WeChat"),
                },
            },
            new()
            {
                Id = "qq",
                Name = "QQ 清理",
                Description = "QQ 的图片、视频与语音缓存",
                Icon = "🐧",
                DetectPath = @"%USERPROFILE%\Documents\Tencent Files",
                Rules = new[]
                {
                    Rule("plugin-qq-files", "QQ 图片与视频缓存",
                        "聊天中接收的媒体缓存副本",
                        @"%USERPROFILE%\Documents\Tencent Files",
                        TargetCategory.AppCache, RiskLevel.Dangerous, null,
                        DeleteStrategy.MatchingEntries, PathMatch.Patterns,
                        null, new[] { "Image", "Video", "Audio", "FileRecv" }),
                    Rule("plugin-qq-appdata", "QQ 运行缓存",
                        "QQ 客户端的运行缓存",
                        @"%APPDATA%\Tencent\QQ",
                        TargetCategory.AppCache, RiskLevel.Caution, "QQ"),
                },
            },
            new()
            {
                Id = "developer",
                Name = "开发者缓存",
                Description = "npm、pip、NuGet、VS Code 的包缓存与编译缓存",
                Icon = "⚙️",
                Rules = new[]
                {
                    Rule("plugin-dev-npm", "npm 缓存",
                        "Node.js 包管理器下载缓存，删后重新下载",
                        @"%APPDATA%\npm-cache",
                        TargetCategory.DeveloperCache, RiskLevel.Caution),
                    Rule("plugin-dev-pip", "pip 缓存",
                        "Python 包管理器的 wheel 缓存",
                        @"%LOCALAPPDATA%\pip\Cache",
                        TargetCategory.DeveloperCache, RiskLevel.Caution),
                    Rule("plugin-dev-nuget", "NuGet 缓存",
                        ".NET 包缓存，删后重新还原",
                        @"%LOCALAPPDATA%\NuGet\v3-cache",
                        TargetCategory.DeveloperCache, RiskLevel.Caution),
                    Rule("plugin-dev-vscode", "VS Code 编译缓存",
                        "V8 编译缓存，删后编辑器首次启动略慢",
                        @"%APPDATA%\Code\CachedData",
                        TargetCategory.DeveloperCache, RiskLevel.Caution, "Code"),
                },
            },
            new()
            {
                Id = "gaming",
                Name = "游戏与显卡缓存",
                Description = "NVIDIA 着色器缓存与 DirectX 着色器缓存",
                Icon = "🎮",
                Rules = new[]
                {
                    Rule("plugin-game-nvidia", "NVIDIA 着色器缓存",
                        "NVIDIA 显卡驱动着色器缓存，通常很大，删后游戏首次启动重新编译",
                        @"%LOCALAPPDATA%\NVIDIA",
                        TargetCategory.AppCache, RiskLevel.Caution, null,
                        DeleteStrategy.MatchingEntries, PathMatch.Patterns,
                        null, new[] { "DXCache", "GLCache", "NV_Cache", "ComputeCache" }),
                    Rule("plugin-game-d3d", "DirectX 着色器缓存",
                        "GPU 着色器编译缓存，删后游戏首次启动稍慢",
                        @"%LOCALAPPDATA%\D3DSCache",
                        TargetCategory.SystemCache, RiskLevel.Safe),
                },
            },
        };
    }

    private static RuleTarget Rule(
        string id,
        string name,
        string description,
        string path,
        TargetCategory category,
        RiskLevel risk,
        string? guardProcess = null,
        DeleteStrategy strategy = DeleteStrategy.ContentsOfDirectory,
        PathMatch match = PathMatch.All,
        string[]? extensions = null,
        string[]? patterns = null)
    {
        return new RuleTarget
        {
            Id = id,
            Name = name,
            Description = description,
            Path = path,
            Category = category,
            Risk = risk,
            GuardProcess = guardProcess,
            Strategy = strategy,
            Match = match,
            Extensions = extensions,
            NamePatterns = patterns,
        };
    }
}
