namespace CacheSweep.Desktop;

/// <summary>Well-known locations used by the tray shell.</summary>
internal static class AppPaths
{
    /// <summary>Folder this desktop exe lives in; the server exe sits beside it.</summary>
    public static string PackageDir => AppContext.BaseDirectory;

    public static string LocalData => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "CacheSweep");

    public static string ServerExe => Path.Combine(PackageDir, "CacheSweep.Server.exe");
}
