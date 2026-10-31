using System.Runtime.InteropServices;

namespace CacheSweep.Desktop;

/// <summary>
/// Native window effects for the embedded browser: Acrylic / Mica backdrops and
/// a true layered window for the "transparent" theme.
///
/// Every call degrades gracefully: on builds without the DWM attribute the
/// window simply falls back to an opaque background, which the web UI already
/// styles sensibly.
/// </summary>
internal static class WindowEffects
{
    /* ---- DWM window composition ---- */

    private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const int DWMWA_SYSTEMBACKDROP_TYPE = 38;
    private const int DWMWA_BORDER_COLOR = 34;
    private const int DWMWA_CAPTION_COLOR = 35;

    private const int DWMSBT_AUTO = 0;
    private const int DWMSBT_NONE = 1;
    private const int DWMSBT_MAINWINDOW = 2;       // Mica
    private const int DWMSBT_TRANSIENTWINDOW = 3;  // Acrylic
    private const int DWMSBT_TABBEDWINDOW = 4;     // Mica Alt

    private const int DWMWCP_ROUND = 2;
    private const int DWMWCP_ROUNDSMALL = 3;

    private const int WCA_ACCENT_POLICY = 19;
    private const int ACCENT_ENABLE_ACRYLICBLURBEHIND = 4;
    private const int ACCENT_ENABLE_BLURBEHIND = 3;

    [StructLayout(LayoutKind.Sequential)]
    private struct AccentPolicy
    {
        public int AccentState;
        public int AccentFlags;
        public int GradientColor;
        public int AnimationId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WindowCompositionAttributeData
    {
        public int Attribute;
        public IntPtr Data;
        public int SizeOfData;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MARGINS
    {
        public int cxLeftWidth;
        public int cxRightWidth;
        public int cyTopHeight;
        public int cyBottomHeight;
    }

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);

    [DllImport("user32.dll")]
    private static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WindowCompositionAttributeData data);

    /// <summary>Windows 11 22H2+ exposes the system backdrop API (Mica/Acrylic).</summary>
    public static bool SupportsSystemBackdrop => Environment.OSVersion.Version.Build >= 22621;

    public static void SetDarkTitleBar(IntPtr hwnd, bool dark)
    {
        var value = dark ? 1 : 0;
        DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref value, sizeof(int));
    }

    public static void SetRoundedCorners(IntPtr hwnd)
    {
        var pref = DWMWCP_ROUND;
        DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref pref, sizeof(int));
    }

    /// <summary>Sets the DWM system backdrop; 0 = none.</summary>
    public static void SetBackdrop(IntPtr hwnd, int backdropType)
    {
        var type = backdropType;
        DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, ref type, sizeof(int));
    }

    /// <summary>
    /// Paints the classic acrylic blur behind the whole window. This is the
    /// effect that makes the "transparent" theme show the desktop through the
    /// page. Requires the window to have a translucent edge (see ExtendGlass).
    /// </summary>
    public static void EnableAcrylic(IntPtr hwnd, byte tintAlpha = 0xB4)
    {
        // GradientColor is 0xAABBGGRR: a very dark blue-grey tint.
        var gradient = unchecked((int)((uint)(tintAlpha << 24) | 0x00120C08));
        var policy = new AccentPolicy
        {
            AccentState = ACCENT_ENABLE_ACRYLICBLURBEHIND,
            AccentFlags = 2,
            GradientColor = gradient,
            AnimationId = 0,
        };

        var size = Marshal.SizeOf<AccentPolicy>();
        var ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(policy, ptr, false);
            var data = new WindowCompositionAttributeData
            {
                Attribute = WCA_ACCENT_POLICY,
                Data = ptr,
                SizeOfData = size,
            };
            SetWindowCompositionAttribute(hwnd, ref data);
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    public static void DisableAcrylic(IntPtr hwnd)
    {
        var policy = new AccentPolicy { AccentState = 0, AccentFlags = 0, GradientColor = 0, AnimationId = 0 };
        var size = Marshal.SizeOf<AccentPolicy>();
        var ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(policy, ptr, false);
            var data = new WindowCompositionAttributeData
            {
                Attribute = WCA_ACCENT_POLICY,
                Data = ptr,
                SizeOfData = size,
            };
            SetWindowCompositionAttribute(hwnd, ref data);
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    /// <summary>
    /// Stretches the glass frame over the client area. Without this the acrylic
    /// effect only paints a border on some Windows versions.
    /// </summary>
    public static void ExtendGlass(IntPtr hwnd)
    {
        var margins = new MARGINS { cxLeftWidth = -1, cxRightWidth = -1, cyTopHeight = -1, cyBottomHeight = -1 };
        DwmExtendFrameIntoClientArea(hwnd, ref margins);
    }

    /// <summary>Applies the full visual treatment for one theme.</summary>
    public static void Apply(IntPtr hwnd, string theme)
    {
        if (hwnd == IntPtr.Zero)
        {
            return;
        }

        SetRoundedCorners(hwnd);
        SetDarkTitleBar(hwnd, theme is "dark" or "transparent");

        switch (theme)
        {
            case "transparent":
                // Acrylic shows the real desktop behind the page.
                DisableAcrylic(hwnd);
                SetBackdrop(hwnd, DWMSBT_TRANSIENTWINDOW);
                EnableAcrylic(hwnd, 0x99);
                ExtendGlass(hwnd);
                break;

            case "light":
                DisableAcrylic(hwnd);
                if (SupportsSystemBackdrop)
                {
                    SetBackdrop(hwnd, DWMSBT_MAINWINDOW);
                }

                break;

            default: // dark
                DisableAcrylic(hwnd);
                SetBackdrop(hwnd, DWMSBT_NONE);
                break;
        }
    }
}
