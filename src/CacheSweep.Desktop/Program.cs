using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Net.Sockets;
using System.Reflection;
using System.Text.Json;

namespace CacheSweep.Desktop;

/// <summary>
/// Tray shell for CacheSweep.
///
/// Responsibilities: start and supervise CacheSweep.Server.exe (hidden, no
/// console), own the main window (an embedded WebView2 rather than an external
/// browser so the transparent theme can be a real acrylic window), and shut the
/// server down cleanly on exit.
/// </summary>
internal static class Program
{
    private const int PreferredPort = 5188;

    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();

        using var mutex = new Mutex(true, @"Global\CacheSweep.SingleInstance", out var isFirst);
        if (!isFirst)
        {
            using var hint = new SecondInstanceForm();
            hint.ShowDialog();
            return;
        }

        var port = ResolvePort(args);
        Application.Run(new TrayContext(port, args));
    }

    private static int ResolvePort(string[] args)
    {
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] is "--port" or "-p" or "/port"
                && i + 1 < args.Length && int.TryParse(args[i + 1], out var p) && p is > 0 and < 65536)
            {
                return p;
            }

            var eq = args[i].IndexOf('=');
            if (eq > 0 && args[i][..eq].Equals("--urls", StringComparison.OrdinalIgnoreCase))
            {
                var value = args[i][(eq + 1)..];
                if (Uri.TryCreate(value, UriKind.Absolute, out var uri))
                {
                    return uri.Port;
                }
            }
        }

        for (var candidate = PreferredPort; candidate < PreferredPort + 40; candidate++)
        {
            if (IsPortFree(candidate))
            {
                return candidate;
            }
        }

        return PreferredPort;
    }

    private static bool IsPortFree(int port)
    {
        try
        {
            using var listener = new TcpListener(System.Net.IPAddress.Loopback, port);
            listener.Start();
            listener.Stop();
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
    }
}

/// <summary>Which window the tray is currently showing.</summary>
internal enum AppMode
{
    Full,
    Compact,
}

/// <summary>Tray icon, menu, window and server supervision.</summary>
internal sealed class TrayContext : ApplicationContext
{
    private readonly int _port;
    private readonly string _url;
    private readonly NotifyIcon _tray;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ContextMenuStrip _menu;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(3) };
    private readonly CancellationTokenSource _stop = new();
    private readonly bool _startHidden;

    private MainWindow? _window;
    private CompactWindow? _compact;
    private ToolStripMenuItem? _modeFull;
    private ToolStripMenuItem? _modeCompact;
    private AppMode _mode = AppMode.Full;
    private Process? _server;
    private bool _exiting;

    public TrayContext(int port, string[] args)
    {
        _port = port;
        _url = $"http://127.0.0.1:{port}";
        _startHidden = args.Any(a => a is "--tray" or "/tray" or "--silent");

        _statusItem = new ToolStripMenuItem("状态：正在启动…") { Enabled = false };

        _menu = new ContextMenuStrip { ShowImageMargin = false, Font = new Font("Segoe UI", 9F) };
        _menu.Items.Add(_statusItem);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(new ToolStripMenuItem("打开 CacheSweep", null, (_, _) => ShowWindow()));
        _menu.Items.Add(new ToolStripMenuItem("立即体检", null, (_, _) => ShowWindow("/?scan=1")));
        // Mode switching: full window vs a compact always-on-top toolbar.
        _modeFull = new ToolStripMenuItem("窗口模式：完整", null, (_, _) => SetMode(AppMode.Full))
        {
            Checked = true,
        };
        _modeCompact = new ToolStripMenuItem("窗口模式：悬浮工具栏", null, (_, _) => SetMode(AppMode.Compact));

        var modeMenu = new ToolStripMenuItem("窗口模式");
        modeMenu.DropDownItems.Add(_modeFull);
        modeMenu.DropDownItems.Add(_modeCompact);

        _menu.Items.Add(new ToolStripMenuItem("在浏览器中打开", null, (_, _) => OpenInBrowser()));
        _menu.Items.Add(modeMenu);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(new ToolStripMenuItem("打开日志目录", null, (_, _) => OpenLogs()));
        _menu.Items.Add(new ToolStripMenuItem("关于…", null, (_, _) => ShowAbout()));
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(new ToolStripMenuItem("退出", null, (_, _) => ExitApp()));

        _tray = new NotifyIcon
        {
            Icon = LoadAppIcon(),
            Text = $"CacheSweep · 正在启动 (端口 {_port})",
            ContextMenuStrip = _menu,
            Visible = true,
        };        _tray.DoubleClick += (_, _) => ShowWindow();
        _tray.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left)
            {
                ShowWindow();
            }
        };

        ApplyDarkMenuTheme();

        StartServer();
        _ = SuperviseAsync();
    }

    /* ---------------- window ---------------- */

    private void EnsureWindow()
    {
        if (_window is { IsDisposed: false })
        {
            return;
        }

        _window = new MainWindow(_url);
        // Closing the window keeps the app in the tray.
        _window.FormClosing += (_, e) =>
        {
            if (!_exiting)
            {
                e.Cancel = true;
                _window?.Hide();
                ShowBalloon("CacheSweep 仍在后台运行，双击托盘图标可重新打开。", ToolTipIcon.Info);
            }
        };
    }

    /// <summary>
    /// Switches between the full window and the compact floating toolbar.
    /// Both share the same server, so nothing restarts.
    /// </summary>
    private void SetMode(AppMode mode)
    {
        _mode = mode;

        if (_modeFull is not null) _modeFull.Checked = mode == AppMode.Full;
        if (_modeCompact is not null) _modeCompact.Checked = mode == AppMode.Compact;

        if (mode == AppMode.Compact)
        {
            _window?.Hide();
            ShowCompact();
        }
        else
        {
            _compact?.Hide();
            ShowWindow();
        }
    }

    private void ShowCompact()
    {
        if (_compact is { IsDisposed: false })
        {
            _compact.Show();
            _compact.BringToFront();
            _compact.Activate();
            return;
        }

        _compact = new CompactWindow(_url, () => SetMode(AppMode.Full));

        // Closing the compact window keeps the app alive in the tray.
        _compact.FormClosing += (_, e) =>
        {
            if (!_exiting)
            {
                e.Cancel = true;
                _compact?.Hide();
            }
        };

        _compact.Show();
    }

    private void ShowWindow(string path = "/")
    {
        EnsureWindow();
        if (_window is null)
        {
            return;
        }

        if (_window.WindowState == FormWindowState.Minimized)
        {
            _window.WindowState = FormWindowState.Normal;
        }

        _window.Show();
        _window.BringToFront();
        _window.Activate();

        // Deep links (?scan=1) are applied by navigating the embedded browser.
        if (path != "/" && _window.Controls.OfType<Microsoft.Web.WebView2.WinForms.WebView2>().FirstOrDefault()
                is { CoreWebView2: not null } web)
        {
            web.CoreWebView2.Navigate(_url + path);
        }
    }

    /* ---------------- server lifecycle ---------------- */

    private void StartServer()
    {
        try
        {
            _server = ServerLauncher.Start(_port);
            _server.EnableRaisingEvents = true;
            _server.Exited += (_, _) => OnServerExited();
        }
        catch (Exception ex)
        {
            SetStatus("启动失败");
            ShowBalloon($"无法启动后台服务：{ex.Message}", ToolTipIcon.Error);
        }
    }

    private void OnServerExited()
    {
        if (_exiting)
        {
            return;
        }

        SetStatus("服务已停止");
        ShowBalloon("后台服务意外退出。托盘菜单中的「重启服务」可以重试。", ToolTipIcon.Warning);

        if (!_menu.Items.ContainsKey("restart"))
        {
            var restart = new ToolStripMenuItem("重启服务", null, (_, _) =>
            {
                _menu.Items.RemoveByKey("restart");
                SetStatus("正在重启…");
                StartServer();
                _ = SuperviseAsync();
            })
            { Name = "restart" };
            _menu.Items.Insert(0, restart);
            _menu.Items.Insert(1, new ToolStripSeparator());
        }
    }

    private async Task SuperviseAsync()
    {
        for (var attempt = 0; attempt < 80 && !_stop.IsCancellationRequested; attempt++)
        {
            try
            {
                await Task.Delay(250, _stop.Token).ConfigureAwait(true);
            }
            catch (TaskCanceledException)
            {
                return;
            }

            try
            {
                using var res = await _http.GetAsync($"{_url}/api/health", _stop.Token).ConfigureAwait(true);
                if (res.IsSuccessStatusCode)
                {
                    await OnReadyAsync().ConfigureAwait(true);
                    return;
                }
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                // Still starting.
            }
        }

        if (!_stop.IsCancellationRequested)
        {
            SetStatus("启动超时");
        }
    }

    private async Task OnReadyAsync()
    {
        SetStatus($"运行中 · 端口 {_port}");

        // Match the window chrome to the theme the user chose last time.
        await SyncWindowThemeAsync().ConfigureAwait(true);

        if (!_startHidden)
        {
            // Honour the last mode the user picked.
            SetMode(_mode);
        }
        else
        {
            ShowBalloon("CacheSweep 已在托盘运行，双击图标打开。", ToolTipIcon.Info);
        }
    }

    private async Task SyncWindowThemeAsync()
    {
        try
        {
            using var res = await _http.GetAsync($"{_url}/api/preferences");
            if (!res.IsSuccessStatusCode)
            {
                return;
            }

            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            if (doc.RootElement.TryGetProperty("theme", out var theme))
            {
                var value = theme.GetString() ?? "dark";
                WindowThemeBridge.Apply(value);
                ApplyTrayIcon(value);
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException)
        {
        }
    }

    /* ---------------- menu actions ---------------- */

    private void OpenInBrowser()
    {
        try
        {
            Process.Start(new ProcessStartInfo(_url) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"无法打开浏览器：{ex.Message}\n\n请手动访问 {_url}",
                "CacheSweep", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private static void OpenLogs()
    {
        var dir = Path.Combine(AppPaths.LocalData, "logs");
        Directory.CreateDirectory(dir);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{dir}\"") { UseShellExecute = true });
    }

    private void ShowAbout()
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.1.0";
        MessageBox.Show(
            $"CacheSweep {version}\n\n磁盘体检与安全清理工具\n默认只读，清理前必须确认。\n\n" +
            $"服务地址：{_url}\n日志目录：{Path.Combine(AppPaths.LocalData, "logs")}\n\n" +
            "MIT License",
            "关于 CacheSweep",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
    }

    /* ---------------- ui helpers ---------------- */

    private void SetStatus(string text)
    {
        void Apply()
        {
            _statusItem.Text = $"状态：{text}";
            _tray.Text = $"CacheSweep · {text}";
        }

        if (_menu.IsHandleCreated && _menu.InvokeRequired)
        {
            _menu.BeginInvoke(Apply);
        }
        else
        {
            Apply();
        }
    }

    private void ShowBalloon(string text, ToolTipIcon icon)
    {
        try
        {
            _tray.ShowBalloonTip(5000, "CacheSweep", text, icon);
        }
        catch (ObjectDisposedException)
        {
        }
    }

    private void ApplyDarkMenuTheme()
    {
        _menu.BackColor = Color.FromArgb(18, 24, 33);
        _menu.ForeColor = Color.FromArgb(220, 235, 245);
        _menu.Renderer = new ToolStripProfessionalRenderer(new DarkColorTable()) { RoundedEdges = false };

        _menu.Opening += (_, _) =>
        {
            foreach (ToolStripItem item in _menu.Items)
            {
                item.ForeColor = item.Enabled
                    ? Color.FromArgb(220, 235, 245)
                    : Color.FromArgb(110, 130, 150);
            }
        };
    }

    /// <summary>
    /// Repaints the tray icon with the fruit of <paramref name="theme"/> so the
    /// notification area matches the UI too.
    /// </summary>
    private void ApplyTrayIcon(string theme)
    {
        void Apply()
        {
            try
            {
                _tray.Icon = ThemeIcons.ForTheme(theme, new Size(32, 32));
            }
            catch (Exception ex) when (ex is ArgumentException or IOException)
            {
                // Keep the current icon on failure.
            }
        }

        if (_tray.Container is null || _tray.ContextMenuStrip is null)
        {
            Apply();
            return;
        }

        if (_tray.ContextMenuStrip.InvokeRequired)
        {
            _tray.ContextMenuStrip.BeginInvoke(Apply);
        }
        else
        {
            Apply();
        }
    }

    private static Icon LoadAppIcon()
    {
        foreach (var path in new[]
                 {
                     Path.Combine(AppContext.BaseDirectory, "Assets", "cachesweep.ico"),
                     Path.Combine(AppPaths.PackageDir, "Assets", "cachesweep.ico"),
                 })
        {
            if (!File.Exists(path))
            {
                continue;
            }

            try
            {
                return new Icon(path, new Size(32, 32));
            }
            catch (ArgumentException)
            {
            }
        }

        try
        {
            var exe = Environment.ProcessPath;
            if (exe is not null && Icon.ExtractAssociatedIcon(exe) is { } icon)
            {
                return icon;
            }
        }
        catch (Exception ex) when (ex is IOException or ArgumentException)
        {
        }

        return SystemIcons.Application;
    }

    /* ---------------- shutdown ---------------- */

    private void ExitApp()
    {
        _exiting = true;
        _stop.Cancel();
        _tray.Visible = false;
        _tray.Dispose();
        _http.Dispose();

        if (_server is { HasExited: false })
        {
            try
            {
                _server.Kill(entireProcessTree: true);
                _server.WaitForExit(3000);
            }
            catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
            {
            }
        }

        _server?.Dispose();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _stop.Cancel();
            _stop.Dispose();
            _http.Dispose();
            _tray.Dispose();
            _window?.Dispose();
            _compact?.Dispose();
            _server?.Dispose();
        }

        base.Dispose(disposing);
    }
}

/// <summary>
/// Lets the tray tell the window which theme to paint before the page loads.
/// Kept separate so TrayContext does not need to reach into WinForms internals.
/// </summary>
internal static class WindowThemeBridge
{
    public static string Pending { get; private set; } = "dark";

    public static void Apply(string theme)
    {
        Pending = theme;
        if (Application.OpenForms.Count > 0)
        {
            foreach (Form form in Application.OpenForms)
            {
                if (form is MainWindow window && window.IsHandleCreated)
                {
                    WindowEffects.Apply(window.Handle, theme);
                }
            }
        }
    }
}

internal sealed class DarkColorTable : ProfessionalColorTable
{
    private static readonly Color Bg = Color.FromArgb(18, 24, 33);
    private static readonly Color Border = Color.FromArgb(48, 62, 80);
    private static readonly Color Hover = Color.FromArgb(30, 52, 60);

    public override Color ToolStripDropDownBackground => Bg;
    public override Color ImageMarginGradientBegin => Bg;
    public override Color ImageMarginGradientMiddle => Bg;
    public override Color ImageMarginGradientEnd => Bg;
    public override Color MenuBorder => Border;
    public override Color MenuItemBorder => Color.FromArgb(52, 255, 158);
    public override Color MenuItemSelected => Hover;
    public override Color MenuItemSelectedGradientBegin => Hover;
    public override Color MenuItemSelectedGradientEnd => Hover;
    public override Color SeparatorDark => Border;
    public override Color SeparatorLight => Bg;
}

/// <summary>Shown when a second copy is launched.</summary>
internal sealed class SecondInstanceForm : Form
{
    public SecondInstanceForm()
    {
        Text = "CacheSweep";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = true;
        ClientSize = new Size(420, 168);
        BackColor = Color.FromArgb(14, 19, 27);
        ForeColor = Color.FromArgb(225, 240, 250);
        Font = new Font("Segoe UI", 9.5F);

        var icon = new PictureBox
        {
            Image = TryLoadIcon(),
            SizeMode = PictureBoxSizeMode.Zoom,
            Location = new Point(20, 26),
            Size = new Size(48, 48),
        };

        var label = new Label
        {
            Text = "CacheSweep 已经在运行了。\n\n请查看任务栏窗口，或系统托盘中的图标。",
            Location = new Point(82, 24),
            Size = new Size(320, 76),
            ForeColor = Color.FromArgb(200, 218, 232),
        };

        var ok = new Button
        {
            Text = "知道了",
            DialogResult = DialogResult.OK,
            Location = new Point(306, 118),
            Size = new Size(94, 30),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(0, 120, 150),
            ForeColor = Color.White,
        };
        ok.FlatAppearance.BorderSize = 0;

        Controls.Add(icon);
        Controls.Add(label);
        Controls.Add(ok);
        AcceptButton = ok;
        CancelButton = ok;
    }

    private static Image? TryLoadIcon()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Assets", "cachesweep.ico");
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            using var ico = new Icon(path, new Size(64, 64));
            return ico.ToBitmap();
        }
        catch (ArgumentException)
        {
            return null;
        }
    }
}
