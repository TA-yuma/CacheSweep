using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace CacheSweep.Desktop;

/// <summary>
/// Compact "toolbar" window: a small always-on-top strip with the essentials
/// (scan, free-space readout, quick clean, expand back to the full window).
///
/// It reuses the same local UI at /?mode=compact, which renders a reduced
/// layout — the full feature set lives in the main window. The two windows
/// share one server, so switching modes never restarts anything.
/// </summary>
internal sealed class CompactWindow : Form
{
    private readonly WebView2 _web = new();
    private readonly string _baseUrl;
    private readonly Action _expand;
    private readonly Label _title = new();
    private readonly PictureBox _icon = new();
    private readonly Button _expandButton = new();
    private readonly Button _closeButton = new();


    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(
        IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HT_CAPTION = 0x2;

    // Keep above normal windows without stealing focus permanently.
    private static readonly IntPtr HWND_TOPMOST = new(-1);
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOACTIVATE = 0x0010;

    private const int BarHeight = 40;

    public CompactWindow(string baseUrl, Action expand)
    {
        _baseUrl = baseUrl;
        _expand = expand;

        Text = "CacheSweep";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        ShowInTaskbar = true;
        TopMost = true;
        MinimumSize = new Size(380, 300);
        Size = new Size(420, 320);
        BackColor = Color.FromArgb(12, 14, 18);
        Padding = new Padding(1, BarHeight, 1, 1);
        Icon = ThemeIcons.ForTheme("dark", new Size(32, 32));

        BuildChrome();

        _web.Dock = DockStyle.Fill;
        _web.DefaultBackgroundColor = Color.Transparent;
        Controls.Add(_web);

        Load += OnLoaded;

        // Position near the bottom-right of the working area, like a HUD.
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 720);
        Location = new Point(area.Right - Width - 24, area.Bottom - Height - 24);
    }

    private void BuildChrome()
    {
        var bar = new Panel
        {
            Dock = DockStyle.None,
            Bounds = new Rectangle(1, 1, Width - 2, BarHeight - 1),
            BackColor = Color.FromArgb(18, 21, 27),
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right,
        };

        bar.MouseDown += DragWindow;

        _icon.Size = new Size(18, 18);
        _icon.SizeMode = PictureBoxSizeMode.Zoom;
        _icon.Image = ThemeIcons.BitmapFor("dark", 18);
        _icon.Location = new Point(11, 11);

        _title.Text = "CacheSweep";
        _title.Font = new Font("Segoe UI", 8.5F, FontStyle.Bold);
        _title.ForeColor = Color.FromArgb(224, 232, 242);
        _title.AutoSize = true;
        _title.Location = new Point(35, 12);
        _title.MouseDown += DragWindow;

        _expandButton.Text = "⤢";
        _expandButton.Size = new Size(26, 24);
        _expandButton.FlatStyle = FlatStyle.Flat;
        _expandButton.FlatAppearance.BorderSize = 0;
        _expandButton.ForeColor = Color.FromArgb(140, 155, 172);
        _expandButton.Font = new Font("Segoe UI", 9F);
        _expandButton.Cursor = Cursors.Hand;
        _expandButton.Click += (_, _) => _expand();
        _expandButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;

        _closeButton.Text = "✕";
        _closeButton.Size = new Size(26, 24);
        _closeButton.FlatStyle = FlatStyle.Flat;
        _closeButton.FlatAppearance.BorderSize = 0;
        _closeButton.ForeColor = Color.FromArgb(140, 155, 172);
        _closeButton.Font = new Font("Segoe UI", 8.5F);
        _closeButton.Cursor = Cursors.Hand;
        _closeButton.Click += (_, _) => Hide();
        _closeButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;

        bar.Controls.AddRange(new Control[] { _icon, _title, _expandButton, _closeButton });

        bar.Resize += (_, _) =>
        {
            _closeButton.Location = new Point(bar.Width - 30, 9);
            _expandButton.Location = new Point(bar.Width - 58, 9);
        };

        Controls.Add(bar);

        Resize += (_, _) =>
        {
            bar.Width = Width - 2;
            _closeButton.Location = new Point(bar.Width - 30, 9);
            _expandButton.Location = new Point(bar.Width - 58, 9);
        };
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

    private async void OnLoaded(object? sender, EventArgs e)
    {
        // Keep it topmost without stealing focus from whatever the user is doing.
        SetWindowPos(Handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

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
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;

            core.NavigationStarting += (_, args) =>
            {
                if (!args.Uri.StartsWith(_baseUrl, StringComparison.OrdinalIgnoreCase))
                {
                    args.Cancel = true;
                }
            };

            core.WebMessageReceived += OnWebMessage;

            // mode=compact switches the page to the reduced toolbar layout.
            core.Navigate(_baseUrl + "?mode=compact");
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"无法启动内嵌浏览器：{ex.Message}",
                "CacheSweep", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;

            // "expand" asks the shell to show the full window.
            if (root.TryGetProperty("action", out var action)
                && action.GetString()?.Equals("expand", StringComparison.OrdinalIgnoreCase) == true)
            {
                BeginInvoke(() =>
                {
                    _expand();
                    Hide();
                });
                return;
            }

            if (root.TryGetProperty("theme", out var themeProp))
            {
                var theme = themeProp.GetString() ?? "dark";
                BeginInvoke(() =>
                {
                    Icon = ThemeIcons.ForTheme(theme, new Size(32, 32));
                    _icon.Image = ThemeIcons.BitmapFor(theme, 18);
                });
            }
        }
        catch (JsonException)
        {
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);

        using var pen = new Pen(Color.FromArgb(48, 56, 68), 1);
        e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);

        // A thin accent line under the title bar ties it to the main window.
        using var brush = new LinearGradientBrush(
            new Rectangle(0, BarHeight - 2, Math.Max(1, Width), 2),
            Color.FromArgb(255, 92, 32),
            Color.FromArgb(64, 200, 230),
            LinearGradientMode.Horizontal);
        e.Graphics.FillRectangle(brush, 0, BarHeight - 2, Width, 1);
    }
}
