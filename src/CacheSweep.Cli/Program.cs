using CacheSweep.Core.Cleaning;
using CacheSweep.Core.Models;
using CacheSweep.Core.Rules;
using CacheSweep.Core.Scanning;

return Cli.Run(args);

internal static class Cli
{
    public static int Run(string[] args)
    {
        if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
        {
            Console.WriteLine(Usage);
            return 0;
        }

        var rejected = new List<(string Id, string Reason)>();
        var userRules = GetOption(args, "--rules");
        var targets = BuiltInRules.Load(userRules, rejected);

        foreach (var r in rejected)
        {
            Console.Error.WriteLine($"[rule rejected] {r.Id}: {r.Reason}");
        }

        return args[0].ToLowerInvariant() switch
        {
            "list" => List(targets),
            "scan" => Scan(targets),
            "clean" => Clean(targets, args),
            _ => Unknown(args[0]),
        };
    }

    private static int List(IReadOnlyList<CleanTarget> targets)
    {
        Console.WriteLine($"{"ID",-24} {"RISK",-10} {"CATEGORY",-20} PATH");
        foreach (var t in targets)
        {
            Console.WriteLine($"{t.Id,-24} {t.Risk,-10} {t.Category,-20} {t.Path}");
        }

        Console.WriteLine($"\n{targets.Count} rules loaded.");
        return 0;
    }

    private static int Scan(IReadOnlyList<CleanTarget> targets)
    {
        Console.WriteLine("Scanning...");
        var report = new Scanner(targets).Scan();
        var ordered = report.Items
            .Where(i => i.Status == "ok" && i.Bytes > 0)
            .OrderByDescending(i => i.Bytes)
            .ToList();

        foreach (var item in ordered)
        {
            Console.WriteLine(
                $"{FormatBytes(item.Bytes),10}  {item.Risk,-10} {item.Name} " +
                $"({item.FileCount} files)  {item.Path}");
        }

        Console.WriteLine();
        Console.WriteLine($"Total reclaimable: {FormatBytes(report.TotalBytes)}");
        Console.WriteLine($"  safe:      {FormatBytes(report.SafeBytes)}");
        Console.WriteLine($"  caution:   {FormatBytes(report.CautionBytes)}");
        Console.WriteLine($"  dangerous: {FormatBytes(report.DangerousBytes)}");
        Console.WriteLine($"Scan took {report.ScanDurationMs} ms.");
        return 0;
    }

    private static int Clean(IReadOnlyList<CleanTarget> targets, string[] args)
    {
        var apply = args.Contains("--apply", StringComparer.OrdinalIgnoreCase);
        var allowDangerous = args.Contains("--dangerous", StringComparer.OrdinalIgnoreCase);
        var permanent = args.Contains("--permanent", StringComparer.OrdinalIgnoreCase);
        var ids = args.Skip(1)
            .Where(a => !a.StartsWith("--", StringComparison.Ordinal))
            .ToList();

        if (ids.Count == 1 && ids[0].Equals("safe", StringComparison.OrdinalIgnoreCase))
        {
            ids = targets.Where(t => t.Risk == RiskLevel.Safe).Select(t => t.Id).ToList();
        }

        if (ids.Count == 0)
        {
            Console.Error.WriteLine("No target ids. Use `cachesweep clean safe` or pass rule ids from `list`.");
            return 2;
        }

        var unknown = ids.Where(id => targets.All(t => t.Id != id)).ToList();
        if (unknown.Count > 0)
        {
            Console.Error.WriteLine($"Unknown rule id(s): {string.Join(", ", unknown)}");
            return 2;
        }

        var options = new CleanOptions
        {
            DryRun = !apply,
            UseRecycleBin = !permanent,
            AllowDangerous = allowDangerous,
        };

        var result = new Cleaner(targets, Console.WriteLine).Clean(ids, options);

        foreach (var item in result.Items)
        {
            var status = item.Success ? "OK  " : "FAIL";
            Console.WriteLine(
                $"[{status}] {item.Name,-28} {FormatBytes(item.FreedBytes),10} " +
                $"{item.DeletedFiles,6} files" +
                (item.Error is null ? string.Empty : $"  ({item.Error})"));
        }

        Console.WriteLine();
        Console.WriteLine(result.DryRun
            ? $"DRY RUN: would free {FormatBytes(result.TotalFreedBytes)} ({result.TotalDeletedFiles} files). Re-run with --apply to delete."
            : $"Freed {FormatBytes(result.TotalFreedBytes)} ({result.TotalDeletedFiles} files). Failures: {result.Failures}.");

        return result.Failures == 0 ? 0 : 1;
    }

    private static int Unknown(string command)
    {
        Console.Error.WriteLine($"Unknown command: {command}");
        Console.Error.WriteLine(Usage);
        return 2;
    }

    private static string? GetOption(string[] args, string name)
    {
        var index = Array.FindIndex(args, a => a.Equals(name, StringComparison.OrdinalIgnoreCase));
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    private static string FormatBytes(long bytes) => bytes switch
    {
        >= 1L << 30 => $"{bytes / (double)(1L << 30):0.00} GB",
        >= 1L << 20 => $"{bytes / (double)(1L << 20):0.0} MB",
        >= 1L << 10 => $"{bytes / (double)(1L << 10):0.0} KB",
        _ => $"{bytes} B",
    };

    private const string Usage = """
        CacheSweep CLI

        Usage:
          cachesweep list                       Show all rules and their paths
          cachesweep scan                       Measure every target (read-only)
          cachesweep clean safe                 PREVIEW deleting all Safe targets
          cachesweep clean safe --apply         Actually delete Safe targets
          cachesweep clean <id> [id...] [--apply] [--dangerous] [--permanent]

        Options:
          --apply        Perform deletion (default is dry-run preview)
          --dangerous    Allow Dangerous targets (e.g. recycle-bin)
          --permanent    Delete permanently instead of moving to the Recycle Bin
          --rules FILE   Load extra rules from a JSON file

        Safety: every path is checked against the allow-list in
        SafePathPolicy before anything is deleted. Targets that fail are
        skipped and reported.
        """;
}
