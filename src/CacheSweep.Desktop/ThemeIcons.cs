using System.Drawing.Drawing2D;

namespace CacheSweep.Desktop;

/// <summary>
/// Resolves the app icon for the active theme.
///
/// The three UI themes each own a fruit icon so the icon in the title bar, the
/// tray and the taskbar matches whatever the user picked:
///
///     dark         -> orange      ember orange
///     transparent  -> grape       cyan-green
///     light        -> sugarcane   steel grey
///
/// Icons ship as .ico next to the exe. If a theme icon is missing the bundled
/// default is used, so the app never shows a blank icon.
/// </summary>
internal static class ThemeIcons
{
    private static readonly Dictionary<string, Icon> Cache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly object Gate = new();

    /// <summary>Maps a UI theme name onto its fruit icon file.</summary>
    public static string FileForTheme(string theme) => theme switch
    {
        "transparent" => "fruit-grape.ico",
        "light" => "fruit-sugarcane.ico",
        _ => "fruit-orange.ico",
    };

    public static Icon ForTheme(string theme, Size size)
    {
        var file = FileForTheme(theme);
        var key = $"{file}@{size.Width}";

        lock (Gate)
        {
            if (Cache.TryGetValue(key, out var cached))
            {
                return cached;
            }

            var icon = LoadIcon(file, size) ?? LoadFallback(size);
            Cache[key] = icon;
            return icon;
        }
    }

    /// <summary>
    /// A raster of the theme mark for the custom title bar, which draws its own
    /// logo instead of relying on the native caption.
    /// </summary>
    public static Bitmap BitmapFor(string theme, int size)
    {
        var icon = ForTheme(theme, new Size(size, size));
        try
        {
            using var scaled = new Icon(icon, new Size(size, size));
            return scaled.ToBitmap();
        }
        catch (ArgumentException)
        {
            // Fall back to a solid disc in the theme colour.
            using var fallback = MakeFallbackBadge(theme, size);
            return new Icon(fallback, new Size(size, size)).ToBitmap();
        }
    }

    /// <summary>True when the packaged theme icons are present.</summary>
    public static bool ThemeIconsAvailable =>
        Directory.Exists(Path.Combine(AppContext.BaseDirectory, "Assets", "themes"));

    private static Icon? LoadIcon(string file, Size size)
    {
        foreach (var dir in new[]
                 {
                     Path.Combine(AppContext.BaseDirectory, "Assets", "themes"),
                     AppPaths.PackageDir,
                 })
        {
            var path = Path.Combine(dir, file);
            if (!File.Exists(path))
            {
                continue;
            }

            try
            {
                return new Icon(path, size);
            }
            catch (Exception ex) when (ex is ArgumentException or IOException)
            {
                // Try the next candidate.
            }
        }

        return null;
    }

    private static Icon LoadFallback(Size size)
    {
        try
        {
            var exe = Environment.ProcessPath;
            if (exe is not null && Icon.ExtractAssociatedIcon(exe) is { } extracted)
            {
                return new Icon(extracted, size);
            }
        }
        catch (Exception ex) when (ex is IOException or ArgumentException)
        {
        }

        return SystemIcons.Application;
    }

    /// <summary>
    /// Builds a small in-process badge used when the fruit .ico files are not
    /// packaged: a disc in the theme colour with a bite mark, so theme changes
    /// are still visible.
    /// </summary>
    public static Icon MakeFallbackBadge(string theme, int size = 32)
    {
        var color = theme switch
        {
            "transparent" => Color.FromArgb(64, 224, 200),
            "light" => Color.FromArgb(176, 194, 212),
            _ => Color.FromArgb(255, 122, 48),
        };

        using var bmp = new Bitmap(size, size);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);

            using var brush = new LinearGradientBrush(
                new Rectangle(0, 0, size, size),
                ControlPaint.Light(color, 0.25f),
                ControlPaint.Dark(color, 0.2f),
                LinearGradientMode.ForwardDiagonal);
            g.FillEllipse(brush, 1, 1, size - 2, size - 2);

            // Specular dot.
            using var hi = new SolidBrush(Color.FromArgb(200, 255, 255, 255));
            g.FillEllipse(hi, size * 0.2f, size * 0.18f, size * 0.26f, size * 0.26f);

            // Stem.
            using var stem = new Pen(Color.FromArgb(120, 90, 60), Math.Max(1.5f, size * 0.08f));
            g.DrawLine(stem, size * 0.5f, size * 0.16f, size * 0.56f, size * 0.04f);
        }

        var hIcon = bmp.GetHicon();
        return Icon.FromHandle(hIcon);
    }
}
