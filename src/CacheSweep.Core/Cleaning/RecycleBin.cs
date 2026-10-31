using System.Runtime.InteropServices;

namespace CacheSweep.Core.Cleaning;

/// <summary>
/// Windows Shell API bindings for the Recycle Bin. Split out so the cleaner can
/// be unit-tested on any OS without touching P/Invoke.
/// </summary>
public static class RecycleBin
{
    private const int SHERB_NOCONFIRMATION = 0x1;
    private const int SHERB_NOPROGRESSUI = 0x2;
    private const int SHERB_NOSOUND = 0x4;

    [DllImport("shell32.dll", EntryPoint = "SHEmptyRecycleBinW", CharSet = CharSet.Unicode, SetLastError = false)]
    private static extern int SHEmptyRecycleBin(nint hwnd, string? pszRootPath, uint dwFlags);

    [DllImport("shell32.dll", EntryPoint = "SHQueryRecycleBinW", CharSet = CharSet.Unicode, SetLastError = false)]
    private static extern int SHQueryRecycleBin(string? pszRootPath, ref SHQUERYRBINFO pSHQueryRBInfo);

    /// <summary>
    /// The native struct is DWORD cbSize followed by two 8-byte ULARGE_INTEGERs.
    /// On x64 those need 8-byte alignment, so cbSize occupies 8 bytes total and
    /// the struct is 24 bytes. A Pack=4 sequential layout yields the wrong size
    /// and SHQueryRecycleBin fails with E_INVALIDARG (0x80070057).
    /// </summary>
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct SHQUERYRBINFO
    {
        [FieldOffset(0)] public int cbSize;
        [FieldOffset(8)] public long i64Size;
        [FieldOffset(16)] public long i64NumItems;
    }

    public static bool IsSupported => OperatingSystem.IsWindows();

    /// <summary>Bytes currently held by the Recycle Bin on <paramref name="driveRoot"/> (e.g. "C:\\").</summary>
    public static long QuerySize(string driveRoot)
    {
        if (!IsSupported)
        {
            return 0;
        }

        var info = new SHQUERYRBINFO { cbSize = Marshal.SizeOf<SHQUERYRBINFO>() };
        var hr = SHQueryRecycleBin(driveRoot, ref info);
        return hr == 0 ? Math.Max(0, info.i64Size) : 0;
    }

    /// <summary>Empties the Recycle Bin for one drive. Returns false on failure.</summary>
    public static bool Empty(string driveRoot)
    {
        if (!IsSupported)
        {
            return false;
        }

        var hr = SHEmptyRecycleBin(0, driveRoot, SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND);
        // S_OK, or S_FALSE when it was already empty.
        return hr is 0 or 1;
    }
}
