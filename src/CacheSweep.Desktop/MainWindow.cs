using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace CacheSweep.Desktop;

/// <summary>
/// The app window: a slim custom title bar plus an embedded WebView2 showing
/// the local UI. The window chrome mirrors the selected theme, and the
/// "transparent" theme turns the whole window into real acrylic glass.
/// </summary>
internal sealed class MainWindow : Form
{
    private const int BarHeight = 48;

    private readonly WebView2 _web = new();
    private readonly Panel _bar = new();
    private readonly Label _title = new();
    private readonly Label _subtitle = new();
    private readonly Button _minimize = new();
    private readonly Button _maximize = new();
    private readonly Button _close = new();
    private readonly Button _refresh = new();
    private readonly PictureBox _titleIcon = new();

    private readonly string _baseUrl;
    private string _theme = "dark";
    private bool _webReady;
    private bool _maximized;

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HT_CAPTION = 0x2;
    private const int WM_SETICON = 0x0080;
    private const int ICON_SMALL = 0;
    private const int ICON_BIG = 1;
    private const int ICON_SMALL2 = 2;

    public MainWindow(string baseUrl)
    {
        _baseUrl = baseUrl;

        Text = "CacheSweep";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(900, 620);
        Size = new Size(1320, 900);
        BackColor = Color.FromArgb(8, 11, 16);
        Padding = new Padding(1);
        DoubleBuffered = true;
        Icon = LoadWindowIcon();

        BuildTitleBar();

        // WebView2 hosts a native child HWND that always paints above WinForms
        // controls, so the title bar cannot simply overlap it. Reserve the bar's
        // height as padding on the form and dock the browser into what is left.
        Padding = new Padding(1, BarHeight, 1, 1);
        _web.Dock = DockStyle.Fill;
        _web.DefaultBackgroundColor = Color.Transparent;
        Controls.Add(_web);
        Controls.Add(_bar);

        Load += OnLoaded;
        Resize += (_, _) => LayoutChrome();
    }

    /* ---------------- chrome ---------------- */

    private void BuildTitleBar()
    {
        // Absolutely positioned over the reserved padding band, not docked, so
        // the browser never has to compete with it for layout space.
        _bar.Dock = DockStyle.None;
        _bar.Height = BarHeight;
        _bar.Padding = new Padding(16, 0, 10, 0);
        _bar.BackColor = Color.FromArgb(14, 19, 26);
        _bar.Location = new Point(1, 1);
        _bar.Width = ClientSize.Width - 2;
        _bar.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

        // The logo is swapped whenever the theme changes, so it lives on a
        // field rather than in a local.
        _titleIcon.Size = new Size(22, 22);
        _titleIcon.SizeMode = PictureBoxSizeMode.Zoom;
        _titleIcon.Image = ThemeIcons.BitmapFor("dark", 22);
        _titleIcon.Location = new Point(16, 13);

        _title.Text = "CacheSweep";
        _title.Font = new Font("Segoe UI", 10F, FontStyle.Bold);
        _title.AutoSize = true;
        _title.ForeColor = Color.FromArgb(230, 241, 255);
        _title.Location = new Point(46, 8);

        _subtitle.Text = "磁盘体检 · 安全清理";
        _subtitle.Font = new Font("Segoe UI", 7.5F);
        _subtitle.AutoSize = true;
        _subtitle.ForeColor = Color.FromArgb(110, 130, 155);
        _subtitle.Location = new Point(47, 26);

        _refresh.Text = "⟳";
        _refresh.Size = new Size(30, 26);
        _refresh.FlatStyle = FlatStyle.Flat;
        _refresh.FlatAppearance.BorderSize = 0;
        _refresh.Font = new Font("Segoe UI", 11F);
        _refresh.Cursor = Cursors.Hand;
        _refresh.Click += (_, _) =>
        {
            if (_webReady)
            {
                _web.Reload();
            }
        };

        _minimize.Text = "—";
        _maximize.Text = "□";
        _close.Text = "✕";

        foreach (var b in new[] { _minimize, _maximize, _close })
        {
            b.Size = new Size(40, 28);
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderSize = 0;
            b.Font = new Font("Segoe UI", 9.5F);
            b.Cursor = Cursors.Hand;
            b.TabStop = false;
        }

        _minimize.Click += (_, _) => WindowState = FormWindowState.Minimized;
        _maximize.Click += (_, _) => ToggleMaximize();
        _close.Click += (_, _) => Hide();

        // Drag the window by the title bar.
        _bar.MouseDown += DragWindow;
        _title.MouseDown += DragWindow;
        _subtitle.MouseDown += DragWindow;
        _bar.DoubleClick += (_, _) => ToggleMaximize();
        _title.DoubleClick += (_, _) => ToggleMaximize();

        _bar.Controls.AddRange(new Control[]
        {
            _titleIcon, _title, _subtitle, _refresh, _minimize, _maximize, _close,
        });

        ApplyChromeTheme();
    }

    private void DragWindow(object? sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left)
        {
            return;
        }

        ReleaseCapture();
        SendMessage(Handle, WM_NCLBUTTONDOWN, HT_CAPTION, IntPtr.Zero);
    }

    private void ToggleMaximize()
    {
        _maximized = !_maximized;
        WindowState = _maximized ? FormWindowState.Maximized : FormWindowState.Normal;
        _maximize.Text = _maximized ? "❐" : "□";
    }

    private void LayoutChrome()
    {
        const int buttonWidth = 40;
        var right = _bar.ClientSize.Width - 10;

        _close.Location = new Point(right - buttonWidth, 10);
        _maximize.Location = new Point(right - buttonWidth * 2 - 2, 10);
        _minimize.Location = new Point(right - buttonWidth * 3 - 4, 10);
        _refresh.Location = new Point(right - buttonWidth * 3 - 44, 11);
    }

    /// <summary>
    /// Swaps the window/taskbar icon for the mark that belongs to
    /// <paramref name="theme"/>, so the taskbar button matches the UI.
    ///
    /// Setting Form.Icon alone does not always reach the taskbar button, and a
    /// WebView2-hosted window ignores the ShowInTaskbar trick, so the icon is
    /// also pushed with WM_SETICON for both the small and big slots.
    /// </summary>
    private void ApplyThemeIcon(string theme)
    {
        try
        {
            var small = ThemeIcons.ForTheme(theme, new Size(16, 16));
            var big = ThemeIcons.ForTheme(theme, new Size(32, 32));

            Icon = big;

            if (IsHandleCreated)
            {
                SendMessage(Handle, WM_SETICON, ICON_SMALL, small.Handle);
                SendMessage(Handle, WM_SETICON, ICON_BIG, big.Handle);
                SendMessage(Handle, WM_SETICON, ICON_SMALL2, small.Handle);
            }

            _titleIcon.Image = ThemeIcons.BitmapFor(theme, 22);
        }
        catch (Exception ex) when (ex is ArgumentException or IOException)
        {
            // Keep the previous icon rather than crashing on a bad file.
        }
    }

    /// <summary>Recolours the custom title bar to match the selected theme.</summary>
    private void ApplyChromeTheme()
    {
        (Color bar, Color text, Color sub, Color hover, Color closeHover) = _theme switch
        {
            // Steel on near-black, ember accent.
            "light" => (
                Color.FromArgb(250, 251, 252),
                Color.FromArgb(21, 26, 32),
                Color.FromArgb(133, 146, 160),
                Color.FromArgb(230, 233, 239),
                Color.FromArgb(192, 32, 32)),
            "transparent" => (
                Color.FromArgb(26, 31, 38),
                Color.FromArgb(240, 245, 250),
                Color.FromArgb(146, 160, 174),
                Color.FromArgb(44, 51, 62),
                Color.FromArgb(214, 60, 70)),
            _ => (
                Color.FromArgb(14, 19, 26),
                Color.FromArgb(230, 241, 255),
                Color.FromArgb(110, 130, 155),
                Color.FromArgb(34, 45, 60),
                Color.FromArgb(214, 60, 70)),
        };

        _bar.BackColor = bar;
        _title.ForeColor = text;
        _subtitle.ForeColor = sub;

        foreach (var b in new[] { _minimize, _maximize, _refresh })
        {
            b.BackColor = bar;
            b.ForeColor = sub;
            b.FlatAppearance.MouseOverBackColor = hover;
            b.FlatAppearance.MouseDownBackColor = hover;
        }

        _close.BackColor = bar;
        _close.ForeColor = sub;
        _close.FlatAppearance.MouseOverBackColor = closeHover;
        _close.FlatAppearance.MouseDownBackColor = closeHover;

        BackColor = _theme switch
        {
            "light" => Color.FromArgb(238, 242, 247),
            "transparent" => Color.FromArgb(10, 14, 20),
            _ => Color.FromArgb(8, 11, 16),
        };

        // Paint a thin accent border on the padded edge.
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);

        var accent = _theme switch
        {
            "light" => Color.FromArgb(200, 212, 226),
            "transparent" => Color.FromArgb(90, 120, 150),
            _ => Color.FromArgb(38, 50, 66),
        };

        using var pen = new Pen(accent, 1);
        e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);

        if (_theme == "transparent" && !_webReady)
        {
            // A subtle gradient behind the browser while it boots.
            using var brush = new LinearGradientBrush(
                ClientRectangle,
                Color.FromArgb(16, 26, 34),
                Color.FromArgb(8, 12, 18),
                LinearGradientMode.ForwardDiagonal);
            e.Graphics.FillRectangle(brush, ClientRectangle);
        }
    }

    /* ---------------- startup ---------------- */

    private async void OnLoaded(object? sender, EventArgs e)
    {
        LayoutChrome();
        WindowEffects.Apply(Handle, _theme);
        ApplyThemeIcon(_theme);

        try
        {
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CacheSweep", "WebView2");
            Directory.CreateDirectory(userData);

            var env = await CoreWebView2Environment.CreateAsync(null, userData);
            await _web.EnsureCoreWebView2Async(env);

            var core = _web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = true;
            core.Settings.AreBrowserAcceleratorKeysEnabled = true;

            // Keep the embedded view on our own origin only.
            core.NavigationStarting += (_, args) =>
            {
                if (!args.Uri.StartsWith(_baseUrl, StringComparison.OrdinalIgnoreCase))
                {
                    args.Cancel = true;
                }
            };

            // The page reports its theme so the native chrome can follow.
            core.WebMessageReceived += OnWebMessage;

            // Belt and braces: after every navigation ask the server which theme
            // is active, in case the page's postMessage was missed.
            core.NavigationCompleted += async (_, _) => await SyncThemeFromServerAsync();

            // embed=1 tells the page the native shell owns the title bar.
            core.Navigate(_baseUrl + "?embed=1");
            _webReady = true;
        }
        catch (Exception ex)
        {
            using var hint = new BrowserFallbackForm(_baseUrl, ex.Message);
            hint.ShowDialog(this);
        }
    }

    /// <summary>
    /// Reads the persisted theme straight from the local API and applies it.
    /// This is the fallback for a dropped postMessage, so the window icon and
    /// chrome always end up matching what the server has stored.
    /// </summary>
    private async Task SyncThemeFromServerAsync()
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };
            using var res = await http.GetAsync($"{_baseUrl}/api/preferences").ConfigureAwait(true);
            if (!res.IsSuccessStatusCode)
            {
                return;
            }

            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync().ConfigureAwait(true));
            if (!doc.RootElement.TryGetProperty("theme", out var prop))
            {
                return;
            }

            var theme = prop.GetString() ?? "dark";
            if (theme == _theme)
            {
                return;
            }

            _theme = theme;
            ApplyChromeTheme();
            LayoutChrome();
            WindowEffects.Apply(Handle, _theme);
            ApplyThemeIcon(_theme);
            Invalidate();
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException)
        {
            // Offline or still starting: keep the current appearance.
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            if (doc.RootElement.TryGetProperty("theme", out var themeProp))
            {
                var theme = themeProp.GetString() ?? "dark";

                // The page can post the same theme more than once (boot + a
                // delayed second post); only react to a real change.
                if (theme != _theme)
                {
                    BeginInvoke(() =>
                    {
                        _theme = theme;
                        ApplyChromeTheme();
                        LayoutChrome();
                        WindowEffects.Apply(Handle, _theme);
                        ApplyThemeIcon(_theme);
                        Invalidate();
                    });
                }
            }
        }
        catch (JsonException)
        {
            // Ignore malformed messages from the page.
        }
    }

    /* ---------------- resources ---------------- */

    private static Icon LoadWindowIcon()
    {
        foreach (var candidate in IconCandidates())
        {
            try
            {
                return new Icon(candidate, new Size(32, 32));
            }
            catch (Exception ex) when (ex is ArgumentException or IOException)
            {
            }
        }

        return SystemIcons.Application;
    }

    private static Image? LoadLogo()
    {
        foreach (var candidate in IconCandidates())
        {
            try
            {
                using var ico = new Icon(candidate, new Size(32, 32));
                return ico.ToBitmap();
            }
            catch (Exception ex) when (ex is ArgumentException or IOException)
            {
            }
        }

        return null;
    }

    private static IEnumerable<string> IconCandidates()
    {
        var beside = Path.Combine(AppContext.BaseDirectory, "Assets", "cachesweep.ico");
        if (File.Exists(beside))
        {
            yield return beside;
        }

        // Fall back to the icon embedded in this executable: extract it once to
        // a temp file because System.Drawing.Icon needs a file or stream.
        string? extracted = null;
        try
        {
            var exe = Environment.ProcessPath;
            if (exe is not null && Icon.ExtractAssociatedIcon(exe) is { } ico)
            {
                extracted = Path.Combine(Path.GetTempPath(), "cachesweep-extracted.ico");
                using var stream = File.Create(extracted);
                ico.Save(stream);
                ico.Dispose();
            }
        }
        catch (Exception ex) when (ex is IOException or ArgumentException or ExternalException)
        {
            extracted = null;
        }

        if (extracted is not null && File.Exists(extracted))
        {
            yield return extracted;
        }
    }
}

/// <summary>
/// Shown when WebView2 cannot start (runtime missing, policy blocked). Opens the
/// same UI in the default browser so the app stays usable.
/// </summary>
internal sealed class BrowserFallbackForm : Form
{
    public BrowserFallbackForm(string url, string reason)
    {
        Text = "CacheSweep";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(480, 210);
        BackColor = Color.FromArgb(14, 19, 27);
        ForeColor = Color.FromArgb(225, 240, 250);
        Font = new Font("Segoe UI", 9.5F);

        var label = new Label
        {
            Text = $"内嵌浏览器无法启动，已在默认浏览器中打开界面。\n\n{reason}\n\n如果界面没有自动打开，请手动访问：\n{url}",
            Location = new Point(20, 18),
            Size = new Size(440, 120),
            ForeColor = Color.FromArgb(200, 218, 232),
        };

        var open = new Button
        {
            Text = "用浏览器打开",
            Location = new Point(320, 158),
            Size = new Size(140, 32),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(0, 120, 150),
            ForeColor = Color.White,
            DialogResult = DialogResult.OK,
        };
        open.FlatAppearance.BorderSize = 0;

        Controls.Add(label);
        Controls.Add(open);
        AcceptButton = open;

        Shown += (_, _) =>
        {
            try
            {
                System.Diagnostics.Process.Start(
                    new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception)
            {
                // The dialog text already tells the user the URL.
            }
        };
    }
}
