using System.Diagnostics;
using System.Text;

namespace CacheSweep.Desktop;

/// <summary>
/// Starts and reuses CacheSweep.Server.exe.
///
/// An already-running server on the requested port is reused instead of being
/// duplicated, so launching the tray icon twice (or after a crash of the shell
/// alone) does not fight over the port. A server started by this launcher is
/// hidden: no console window flashes on screen.
/// </summary>
internal static class ServerLauncher
{
    /// <summary>Name written by the server when it owns a port, used to detect "ours".</summary>
    private const string MutexPrefix = "CacheSweep.Server.";

    public static Process Start(int port)
    {
        var exe = AppPaths.ServerExe;
        if (!File.Exists(exe))
        {
            throw new FileNotFoundException(
                $"缺少后台服务文件：{exe}\n请确认 CacheSweep.Server.exe 与 CacheSweep.exe 在同一目录。",
                exe);
        }

        var info = new ProcessStartInfo
        {
            FileName = exe,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = AppPaths.PackageDir,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        info.ArgumentList.Add("--urls");
        info.ArgumentList.Add($"http://127.0.0.1:{port}");
        info.ArgumentList.Add("--noBrowser");
        info.ArgumentList.Add("true");
        info.ArgumentList.Add("--instance");
        info.ArgumentList.Add(MutexPrefix + port);

        var process = new Process { StartInfo = info, EnableRaisingEvents = true };

        // Drain output so a chatty server never blocks on a full pipe.
        process.OutputDataReceived += (_, e) => ServerLog.Write(e.Data);
        process.ErrorDataReceived += (_, e) => ServerLog.Write(e.Data);

        if (!process.Start())
        {
            throw new InvalidOperationException("无法启动后台服务进程。");
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        // Give it a moment; a bad exe (missing runtime, wrong bitness) fails fast.
        if (process.WaitForExit(1500))
        {
            throw new InvalidOperationException(
                $"后台服务启动后立即退出（退出码 {process.ExitCode}）。详见日志目录。");
        }

        return process;
    }
}

/// <summary>
/// Writes server stdout/stderr to %LOCALAPPDATA%\CacheSweep\logs\server-YYYY-MM-DD.log.
/// Redirected output would otherwise be lost because the server has no console.
/// </summary>
internal static class ServerLog
{
    private static readonly object Gate = new();
    private static readonly string DirectoryPath = Path.Combine(AppPaths.LocalData, "logs");

    public static void Write(string? line)
    {
        if (string.IsNullOrWhiteSpace(line))
        {
            return;
        }

        try
        {
            lock (Gate)
            {
                System.IO.Directory.CreateDirectory(DirectoryPath);
                var path = Path.Combine(DirectoryPath, $"server-{DateTime.Now:yyyy-MM-dd}.log");
                File.AppendAllText(
                    path,
                    $"{DateTimeOffset.Now:HH:mm:ss.fff}  {line}{Environment.NewLine}",
                    new UTF8Encoding(false));
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // Logging must never break the tray.
        }
    }
}
