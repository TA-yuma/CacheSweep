using System.Diagnostics;
using CacheSweep.Server;
using CacheSweep.Server.Api;

// A published single-file exe is usually launched by double-click or from a
// shortcut, so the working directory is arbitrary (often System32). Anchor the
// content root to the folder that actually contains wwwroot:
//   1. next to the exe            (published layout, and the desktop shell)
//   2. the project directory      (dotnet run, where the exe lives in bin\)
//   3. the current directory      (last resort, matches ASP.NET's default)
var webRoot = ResolveWebRoot();

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = Path.GetDirectoryName(webRoot) ?? AppContext.BaseDirectory,
    WebRootPath = webRoot,
});

// Bind to loopback by default: this is a local tool, not a network service.
var url = builder.Configuration["urls"] ?? "http://127.0.0.1:5188";
if (!url.Contains("127.0.0.1") && !url.Contains("localhost"))
{
    Console.WriteLine($"[warn] Binding to {url} exposes disk information to the network.");
}

builder.WebHost.UseUrls(url);
builder.Services.AddSingleton<SweepService>();
// Drives automatic cleanup on a timer; runs only while the server is up.
// Same in desktop and web mode: the tray shell keeps the server alive.
builder.Services.AddHostedService<AutoCleanWorker>();
builder.Services.AddHostedService<StartupOpenBrowser>();
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});

var app = builder.Build();

app.Use(async (ctx, next) =>
{
    // Only allow same-origin form posts: this stops a random website from
    // driving the cleaner through a cross-site request.
    if (!HttpMethods.IsGet(ctx.Request.Method) && !HttpMethods.IsHead(ctx.Request.Method))
    {
        var origin = ctx.Request.Headers.Origin.ToString();
        if (!string.IsNullOrEmpty(origin)
            && !origin.Equals($"{ctx.Request.Scheme}://{ctx.Request.Host}", StringComparison.OrdinalIgnoreCase))
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }
    }

    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
    ctx.Response.Headers["Referrer-Policy"] = "no-referrer";
    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();
app.MapCacheSweepApi();

Console.WriteLine($"CacheSweep listening on {url} (webroot: {webRoot})");
app.Run();

static string ResolveWebRoot()
{
    var candidates = new List<string>
    {
        // Published layout / desktop package: wwwroot sits beside the exe.
        Path.Combine(AppContext.BaseDirectory, "wwwroot"),
    };

    // `dotnet run` puts the exe in bin/<config>/<tfm>, so walk up looking for
    // the project's own wwwroot.
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    for (var i = 0; i < 6 && dir is not null; i++)
    {
        candidates.Add(Path.Combine(dir.FullName, "wwwroot"));
        dir = dir.Parent;
    }

    candidates.Add(Path.Combine(Directory.GetCurrentDirectory(), "wwwroot"));

    foreach (var candidate in candidates)
    {
        if (File.Exists(Path.Combine(candidate, "index.html")))
        {
            return candidate;
        }
    }

    // Report the expected published location so the log explains the 404.
    return candidates[0];
}

internal sealed class StartupOpenBrowser : BackgroundService
{
    private readonly IConfiguration _config;
    private readonly ILogger<StartupOpenBrowser> _logger;

    public StartupOpenBrowser(IConfiguration config, ILogger<StartupOpenBrowser> logger)
    {
        _config = config;
        _logger = logger;
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_config.GetValue("openBrowser", true) || _config.GetValue("noBrowser", false))
        {
            return Task.CompletedTask;
        }

        var url = _config["urls"] ?? "http://127.0.0.1:5188";
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Could not open browser automatically: {Message}", ex.Message);
        }

        return Task.CompletedTask;
    }
}
