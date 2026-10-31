using System.Diagnostics;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json.Serialization;

namespace CacheSweep.Server.Api;

/// <summary>
/// Reports the running version and checks GitHub Releases for a newer one.
///
/// The check is opt-in from the UI (a button in Settings), never automatic at
/// startup: an app that phones home on launch without being asked is a privacy
/// problem. The result also distinguishes "no releases published yet" from
/// "network unavailable" so the message can be honest.
/// </summary>
public sealed class UpdateChecker
{
    private const string ReleasesApi =
        "https://api.github.com/repos/TA-yuma/CacheSweep/releases/latest";

    private static readonly HttpClient Http = CreateClient();

    private static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
        // GitHub requires a User-Agent; without one the request is rejected.
        client.DefaultRequestHeaders.UserAgent.ParseAdd("CacheSweep-UpdateCheck/1.0");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    /// <summary>The version this build reports, e.g. "1.0.1".</summary>
    public static string CurrentVersion
    {
        get
        {
            var asm = Assembly.GetEntryAssembly() ?? Assembly.GetExecutingAssembly();
            var info = asm.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
            if (!string.IsNullOrWhiteSpace(info))
            {
                // Strip a trailing "+<commit>" if the SDK appended one.
                var plus = info.IndexOf('+');
                return plus > 0 ? info[..plus] : info;
            }

            return asm.GetName().Version?.ToString(3) ?? "0.0.0";
        }
    }

    /// <summary>
    /// Asks GitHub for the latest published release and compares versions.
    /// Never throws: any failure is reported as a status the UI can render.
    /// </summary>
    public async Task<UpdateCheckResult> CheckAsync(string? repoUrl, CancellationToken ct)
    {
        var current = CurrentVersion;

        try
        {
            using var res = await Http.GetAsync(ReleasesApi, ct).ConfigureAwait(false);

            if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                // Repo exists but has no published release yet.
                return new UpdateCheckResult
                {
                    CurrentVersion = current,
                    Status = "no-release",
                    Message = "尚未发布任何版本",
                    ReleaseUrl = $"https://github.com/TA-yuma/CacheSweep/releases",
                };
            }

            if (!res.IsSuccessStatusCode)
            {
                return new UpdateCheckResult
                {
                    CurrentVersion = current,
                    Status = "unavailable",
                    Message = $"无法检查更新（HTTP {(int)res.StatusCode}）",
                };
            }

            var release = await res.Content
                .ReadFromJsonAsync<GitHubRelease>(cancellationToken: ct)
                .ConfigureAwait(false);

            if (release is null || string.IsNullOrWhiteSpace(release.TagName))
            {
                return new UpdateCheckResult
                {
                    CurrentVersion = current,
                    Status = "unavailable",
                    Message = "更新信息格式无法识别",
                };
            }

            var latest = Normalize(release.TagName);
            var newer = Compare(latest, current) > 0;

            return new UpdateCheckResult
            {
                CurrentVersion = current,
                LatestVersion = latest,
                Status = newer ? "update-available" : "up-to-date",
                Message = newer
                    ? $"有新版本：{latest}"
                    : "已是最新版本",
                ReleaseUrl = release.HtmlUrl,
                DownloadUrl = release.Assets?.FirstOrDefault()?.BrowserDownloadUrl,
                PublishedAt = release.PublishedAt,
            };
        }
        catch (OperationCanceledException)
        {
            return new UpdateCheckResult
            {
                CurrentVersion = current,
                Status = "unavailable",
                Message = "检查超时",
            };
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new UpdateCheckResult
            {
                CurrentVersion = current,
                Status = "unavailable",
                Message = "网络不可用，无法检查更新",
            };
        }
    }

    /// <summary>Strips a leading "v" and any pre-release suffix.</summary>
    private static string Normalize(string tag)
    {
        var value = tag.Trim();
        if (value.StartsWith('v') || value.StartsWith('V'))
        {
            value = value[1..];
        }

        var dash = value.IndexOf('-');
        return dash > 0 ? value[..dash] : value;
    }

    /// <summary>Compares dotted numeric versions; returns 1, 0 or -1.</summary>
    internal static int Compare(string a, string b)
    {
        static int[] Parts(string s) => s
            .Split('.')
            .Select(p => int.TryParse(p, out var n) ? n : 0)
            .ToArray();

        var pa = Parts(a);
        var pb = Parts(b);
        var len = Math.Max(pa.Length, pb.Length);

        for (var i = 0; i < len; i++)
        {
            var x = i < pa.Length ? pa[i] : 0;
            var y = i < pb.Length ? pb[i] : 0;
            if (x != y)
            {
                return x > y ? 1 : -1;
            }
        }

        return 0;
    }

    private sealed class GitHubRelease
    {
        [JsonPropertyName("tag_name")]
        public string? TagName { get; set; }

        [JsonPropertyName("html_url")]
        public string? HtmlUrl { get; set; }

        [JsonPropertyName("published_at")]
        public DateTimeOffset? PublishedAt { get; set; }

        [JsonPropertyName("assets")]
        public List<GitHubAsset>? Assets { get; set; }
    }

    private sealed class GitHubAsset
    {
        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("browser_download_url")]
        public string? BrowserDownloadUrl { get; set; }
    }
}

/// <summary>Result of an update check, shaped for direct JSON serialisation.</summary>
public sealed record UpdateCheckResult
{
    public required string CurrentVersion { get; init; }
    public string? LatestVersion { get; init; }

    /// <summary>"up-to-date" | "update-available" | "no-release" | "unavailable".</summary>
    public required string Status { get; init; }

    public required string Message { get; init; }
    public string? ReleaseUrl { get; init; }
    public string? DownloadUrl { get; init; }
    public DateTimeOffset? PublishedAt { get; init; }
}
