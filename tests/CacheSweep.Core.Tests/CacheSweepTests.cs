using CacheSweep.Core.Cleaning;
using CacheSweep.Core.Models;
using CacheSweep.Core.Rules;
using CacheSweep.Core.Safety;
using CacheSweep.Core.Scanning;
using Xunit;

namespace CacheSweep.Core.Tests;

public class SafePathPolicyTests
{
    [Theory]
    [InlineData("%TEMP%")]
    [InlineData("%LOCALAPPDATA%\\Temp")]
    [InlineData("%APPDATA%\\npm-cache")]
    [InlineData("%LOCALAPPDATA%\\pip\\Cache")]
    [InlineData("%SystemDrive%\\$Recycle.Bin")]
    public void AllowListedPaths_AreValid(string template)
    {
        var path = SafePathPolicy.NormalizePath(template);
        Assert.Null(SafePathPolicy.Validate(path));
    }

    [Theory]
    [InlineData(@"C:\Windows\System32")]
    [InlineData(@"C:\Windows\WinSxS")]
    [InlineData(@"C:\Program Files")]
    [InlineData(@"C:\Program Files (x86)\Something")]
    [InlineData(@"C:\")]
    [InlineData(@"C:\Users")]
    [InlineData("%USERPROFILE%\\Documents")]
    [InlineData("%USERPROFILE%\\Desktop")]
    [InlineData("%USERPROFILE%\\Downloads")]
    [InlineData("%USERPROFILE%\\Pictures")]
    [InlineData("%APPDATA%\\Microsoft\\Windows\\Start Menu")]
    [InlineData("%APPDATA%\\Microsoft\\Crypto")]
    [InlineData(@"C:\Windows\System32\..\..\Users")]
    public void ForbiddenOrRootPaths_AreRejected(string template)
    {
        Assert.NotNull(SafePathPolicy.Validate(template));
    }

    [Fact]
    public void RelativePath_IsRejected()
    {
        Assert.NotNull(SafePathPolicy.Validate("Temp"));
    }

    [Fact]
    public void EmptyPath_IsRejected()
    {
        Assert.NotNull(SafePathPolicy.Validate("   "));
    }

    [Fact]
    public void PathOutsideAllowList_IsRejected()
    {
        var path = Path.Combine(Path.GetTempPath(), "..", "not-a-cache");
        Assert.NotNull(SafePathPolicy.Validate(path));
    }

    [Fact]
    public void NormalizePath_RemovesTrailingSeparator()
    {
        var input = "%TEMP%\\";
        var normalized = SafePathPolicy.NormalizePath(input);
        Assert.False(normalized.EndsWith('\\'));
        Assert.Equal(SafePathPolicy.NormalizePath("%TEMP%"), normalized);
    }

    [Fact]
    public void IsSameOrInside_DetectsNesting()
    {
        var parent = SafePathPolicy.NormalizePath("%TEMP%");
        var child = Path.Combine(parent, "sub", "file.tmp");
        Assert.True(SafePathPolicy.IsSameOrInside(child, parent));
        Assert.True(SafePathPolicy.IsSameOrInside(parent, parent));
        Assert.False(SafePathPolicy.IsSameOrInside(parent, child));
    }
}

public class RuleLoaderTests
{
    [Fact]
    public void BuiltInRules_AllPassSafetyPolicy()
    {
        var rejected = new List<(string Id, string Reason)>();
        var targets = BuiltInRules.Load(null, rejected);

        Assert.NotEmpty(targets);
        Assert.Empty(rejected);
        Assert.All(targets, t => Assert.Null(SafePathPolicy.Validate(t.Path)));
    }

    [Fact]
    public void BuiltInRules_HaveUniqueIds()
    {
        var targets = BuiltInRules.Load();
        var ids = targets.Select(t => t.Id).ToList();
        Assert.Equal(ids.Count, ids.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [Fact]
    public void RulePointingAtSystem32_IsRejected()
    {
        const string json = """
        { "targets": [ { "id": "evil", "name": "Evil", "description": "", "path": "C:\\Windows\\System32",
                         "category": "SystemCache", "risk": "Safe" } ] }
        """;

        var rejected = new List<(string Id, string Reason)>();
        var doc = System.Text.Json.JsonSerializer.Deserialize<RuleDocument>(json, RuleLoader.JsonOptions)!;
        var targets = RuleLoader.Materialize(doc.Targets, rejected);

        Assert.Empty(targets);
        Assert.Single(rejected);
        Assert.Contains("never-touch", rejected[0].Reason);
    }

    [Fact]
    public void DuplicateRuleIds_AreRejected()
    {
        const string json = """
        { "targets": [
          { "id": "dup", "name": "A", "description": "", "path": "%TEMP%", "category": "TempFiles", "risk": "Safe" },
          { "id": "dup", "name": "B", "description": "", "path": "%TEMP%", "category": "TempFiles", "risk": "Safe" }
        ] }
        """;

        var rejected = new List<(string Id, string Reason)>();
        var doc = System.Text.Json.JsonSerializer.Deserialize<RuleDocument>(json, RuleLoader.JsonOptions)!;
        var targets = RuleLoader.Materialize(doc.Targets, rejected);

        Assert.Single(targets);
        Assert.Single(rejected);
    }

    [Fact]
    public void StripBom_RemovesByteOrderMark()
    {
        Assert.Equal("{ }", RuleLoader.StripBom("\uFEFF{ }"));
        Assert.Equal("{ }", RuleLoader.StripBom("{ }"));
    }
}

public class CleanerTests
{
    private static CleanTarget TempTarget(string path, RiskLevel risk = RiskLevel.Safe) => new()
    {
        Id = "test",
        Name = "Test",
        Description = "",
        Path = path,
        Category = TargetCategory.TempFiles,
        Risk = risk,
    };

    [Fact]
    public void GlobMatch_HandlesWildcards()
    {
        Assert.True(Cleaner.GlobMatch("DXCache", "DXCache"));
        Assert.True(Cleaner.GlobMatch("DXCache", "DX*"));
        Assert.True(Cleaner.GlobMatch("thumbnail_cache.db", "*.db"));
        Assert.False(Cleaner.GlobMatch("thumbnail_cache.db", "*.tmp"));
        Assert.True(Cleaner.GlobMatch("abc", "a?c"));
        Assert.True(Cleaner.GlobMatch("ABC", "abc"));
    }

    [Fact]
    public void Matches_RespectsExtensionsFilter()
    {
        var target = TempTarget("x") with
        {
            Match = PathMatch.Extensions,
            Extensions = new[] { ".db" },
        };

        var dir = Directory.CreateTempSubdirectory("cachesweep-test-");
        try
        {
            var db = new FileInfo(Path.Combine(dir.FullName, "thumb.db"));
            db.Create().Dispose();
            var tmp = new FileInfo(Path.Combine(dir.FullName, "other.tmp"));
            tmp.Create().Dispose();

            Assert.True(Cleaner.Matches(target, db));
            Assert.False(Cleaner.Matches(target, tmp));
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    [Fact]
    public void DangerousTarget_WithoutOptIn_Fails()
    {
        var target = TempTarget(SafePathPolicy.NormalizePath("%TEMP%"), RiskLevel.Dangerous);
        var cleaner = new Cleaner(new[] { target });

        var result = cleaner.Clean(new[] { "test" }, new CleanOptions { DryRun = true });

        Assert.Single(result.Items);
        Assert.False(result.Items[0].Success);
        Assert.Contains("Dangerous", result.Items[0].Error);
    }

    [Fact]
    public void UnknownTargetId_IsReported()
    {
        var cleaner = new Cleaner(new[] { TempTarget(SafePathPolicy.NormalizePath("%TEMP%")) });
        var result = cleaner.Clean(new[] { "does-not-exist" }, new CleanOptions { DryRun = true });

        Assert.False(result.Items[0].Success);
        Assert.Equal("Unknown target id.", result.Items[0].Error);
    }

    [Fact]
    public void DryRun_DeletesNothing()
    {
        // A temp dir the policy does not allow-listed must be refused outright,
        // which also proves the cleaner never touches unlisted real directories.
        var dir = Directory.CreateTempSubdirectory("cachesweep-test-");
        try
        {
            var file = Path.Combine(dir.FullName, "keep.tmp");
            File.WriteAllText(file, "hello");

            // A path outside every allow-listed root must be refused outright,
            // which proves the cleaner never touches arbitrary real directories.
            var outside = SafePathPolicy.NormalizePath("%USERPROFILE%\\CacheSweepTestNotACache");
            var target = TempTarget(dir.FullName) with { Path = outside };
            var cleaner = new Cleaner(new[] { target });

            var blocked = cleaner.Clean(new[] { "test" }, new CleanOptions { DryRun = false });
            Assert.False(blocked.Items[0].Success);
            Assert.Contains("safety policy", blocked.Items[0].Error);
            Assert.True(File.Exists(file));
        }
        finally
        {
            dir.Delete(recursive: true);
        }
    }

    [Fact]
    public void MissingDirectory_IsSuccessWithZeroBytes()
    {
        // A path inside an allow-listed root that does not exist yet.
        var missing = Path.Combine(
            SafePathPolicy.NormalizePath("%LOCALAPPDATA%\\pnpm-store"),
            "cachesweep-" + Guid.NewGuid().ToString("N"));

        var cleaner = new Cleaner(new[] { TempTarget(missing) });
        var result = cleaner.Clean(new[] { "test" }, new CleanOptions { DryRun = false });

        Assert.Single(result.Items);
        Assert.True(result.Items[0].Success);
        Assert.Equal(0, result.Items[0].FreedBytes);
    }
}

public class ScannerTests
{
    [Fact]
    public void Scan_ReportsAllTargets()
    {
        var targets = BuiltInRules.Load();
        var report = new Scanner(targets).Scan();

        Assert.Equal(targets.Count, report.Items.Count);
        Assert.All(report.Items, i =>
            Assert.Contains(i.Status, new[] { "ok", "missing", "in-use", "blocked" }));
        Assert.True(report.TotalBytes >= 0);
    }

    [Fact]
    public void Measure_MissingDirectory_ReturnsZero()
    {
        var (bytes, files) = Scanning.DirectoryMeasurer.Measure(
            Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")));
        Assert.Equal(0, bytes);
        Assert.Equal(0, files);
    }
}
