using System.Diagnostics;
using CacheSweep.Core.Models;
using CacheSweep.Core.Rules;
using CacheSweep.Server.Api;

namespace CacheSweep.Server;

public static class ApiEndpoints
{
    public static void MapCacheSweepApi(this WebApplication app)
    {
        var api = app.MapGroup("/api");

        MapHealth(api);
        MapTargets(api);
        MapScanAndClean(api);
        MapPreferences(api);
        MapInventory(api);
    }

    private static void MapHealth(RouteGroupBuilder api) =>
        api.MapGet("/health", () => Results.Ok(new
        {
            status = "ok",
            app = "CacheSweep",
            version = typeof(ApiEndpoints).Assembly.GetName().Version?.ToString(),
            os = Environment.OSVersion.VersionString,
            webview = Environment.GetEnvironmentVariable("CACHESWEEP_EMBEDDED") == "1",
        }));

    private static void MapTargets(RouteGroupBuilder api)
    {
        api.MapGet("/targets", (SweepService service) => Results.Ok(new
        {
            targets = service.AllTargets.Select(Describe),
            ignored = service.GetIgnoredIds(),
            rejected = service.RejectedRules.Select(r => new { r.Id, r.Reason }),
        }));

        // Ignore / re-enable a set of targets: the user's blacklist.
        api.MapPost("/targets/toggle", (ToggleRequest request, SweepService service) =>
        {
            if (request.TargetIds.Count == 0)
            {
                return Results.BadRequest(new { error = "No target ids supplied." });
            }

            var targets = service.SetTargetEnabled(request.TargetIds, request.Enabled);
            return Results.Ok(new
            {
                targets = targets.Select(Describe),
                ignored = service.GetIgnoredIds(),
            });
        });

        api.MapPost("/targets/custom", (RuleTarget rule, SweepService service) =>
        {
            var (created, error) = service.AddCustomTarget(rule);
            return created is null
                ? Results.BadRequest(new { error })
                : Results.Ok(new { target = Describe(created) });
        });

        api.MapDelete("/targets/custom/{id}", (string id, SweepService service) =>
            service.RemoveCustomTarget(id)
                ? Results.Ok(new { removed = id })
                : Results.NotFound(new { error = "Custom target not found." }));
    }

    private static void MapScanAndClean(RouteGroupBuilder api)
    {
        api.MapPost("/scan", async (SweepService service, CancellationToken ct) =>
        {
            var report = await Task.Run(() => service.Scan(ct), ct);
            return Results.Ok(ToDto(report));
        });

        api.MapPost("/clean", async (CleanRequest request, SweepService service, CancellationToken ct) =>
        {
            if (request.TargetIds.Count == 0)
            {
                return Results.BadRequest(new { error = "No target ids supplied." });
            }

            var result = await Task.Run(() => service.Clean(request, ct), ct);
            return Results.Ok(new
            {
                dryRun = result.DryRun,
                startedAt = result.StartedAt,
                durationMs = result.DurationMs,
                totalFreedBytes = result.TotalFreedBytes,
                totalDeletedFiles = result.TotalDeletedFiles,
                failures = result.Failures,
                items = result.Items.Select(i => new
                {
                    i.Id,
                    i.Name,
                    i.Path,
                    i.FreedBytes,
                    i.DeletedFiles,
                    i.Success,
                    i.Error,
                }),
            });
        });
    }

    private static void MapPreferences(RouteGroupBuilder api)
    {
        api.MapGet("/preferences", (SweepService service) => Results.Ok(new
        {
            theme = service.Preferences.Theme,
            ignored = service.GetIgnoredIds(),
            customCount = service.Preferences.CustomTargets.Count,
        }));

        api.MapPost("/preferences/theme", (ThemeRequest request, SweepService service) =>
        {
            service.SetTheme(request.Theme ?? "dark");
            return Results.Ok(new { theme = service.Preferences.Theme });
        });

        api.MapGet("/audit", (SweepService service) => Results.Ok(service.GetAuditLog().TakeLast(200)));
    }

    private static void MapInventory(RouteGroupBuilder api)
    {
        // Installed programs and how much disk each one occupies.
        api.MapGet("/inventory/apps", async (SweepService service, CancellationToken ct) =>
        {
            var sw = Stopwatch.StartNew();
            var apps = await Task.Run(() => service.GetInstalledApps(ct), ct);
            return Results.Ok(new
            {
                durationMs = sw.ElapsedMilliseconds,
                count = apps.Count,
                totalBytes = apps.Sum(a => a.Bytes),
                apps = apps.Select(a => new
                {
                    a.Name,
                    a.Publisher,
                    a.Version,
                    a.InstallLocation,
                    a.Bytes,
                    a.FileCount,
                    a.LocationMissing,
                }),
            });
        });

        // Largest individual files, so users can spot the real space hogs.
        api.MapGet("/inventory/large-files", async (
            string? root, long? minMb, int? take, SweepService service, CancellationToken ct) =>
        {
            var minBytes = (minMb ?? 100) * 1024L * 1024L;
            var count = take ?? 50;

            try
            {
                var files = await Task.Run(
                    () => service.GetLargeFiles(root, minBytes, count, ct), ct);

                return Results.Ok(new
                {
                    root = root ?? "C:\\",
                    count = files.Count,
                    totalBytes = files.Sum(f => f.Bytes),
                    files = files.Select(f => new
                    {
                        f.Path,
                        f.Name,
                        f.Bytes,
                        lastWriteUtc = f.LastWriteUtc,
                        f.Extension,
                    }),
                });
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        // Top-level folder sizes for a drive.
        api.MapGet("/inventory/folders", async (string? drive, SweepService service, CancellationToken ct) =>
        {
            var target = string.IsNullOrWhiteSpace(drive) ? "C:\\" : drive;
            try
            {
                var folders = await Task.Run(() => service.GetFolderUsage(target, ct), ct);
                return Results.Ok(new
                {
                    drive = target,
                    folders = folders.Select(f => new { f.Path, f.Name, f.Bytes, f.FileCount }),
                });
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        api.MapGet("/inventory/drives", () =>
        {
            var drives = new List<object>();
            foreach (var drive in DriveInfo.GetDrives())
            {
                try
                {
                    if (!drive.IsReady || drive.DriveType is not (DriveType.Fixed or DriveType.Removable))
                    {
                        continue;
                    }

                    drives.Add(new
                    {
                        name = drive.Name,
                        label = drive.VolumeLabel,
                        format = drive.DriveFormat,
                        totalBytes = drive.TotalSize,
                        freeBytes = drive.AvailableFreeSpace,
                        usedBytes = drive.TotalSize - drive.AvailableFreeSpace,
                    });
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // A drive that disappears mid-enumeration is skipped.
                }
            }

            return Results.Ok(drives);
        });
    }

    private static object Describe(CleanTarget t) => new
    {
        t.Id,
        t.Name,
        t.Description,
        t.Path,
        category = t.Category.ToString(),
        risk = t.Risk.ToString(),
        strategy = t.Strategy.ToString(),
        t.OlderThanDays,
        t.GuardProcess,
        enabled = t.Enabled,
        isCustom = t.Id.StartsWith("custom-", StringComparison.OrdinalIgnoreCase),
    };

    private static object ToDto(ScanReport r) => new
    {
        r.MachineName,
        r.OsVersion,
        r.ScannedAt,
        r.ScanDurationMs,
        totals = new
        {
            bytes = r.TotalBytes,
            safeBytes = r.SafeBytes,
            cautionBytes = r.CautionBytes,
            dangerousBytes = r.DangerousBytes,
        },
        items = r.Items.Select(i => new
        {
            i.Id,
            i.Name,
            i.Description,
            i.Path,
            category = i.Category.ToString(),
            risk = i.Risk.ToString(),
            strategy = i.Strategy.ToString(),
            i.Bytes,
            i.FileCount,
            i.Status,
        }),
    };
}
