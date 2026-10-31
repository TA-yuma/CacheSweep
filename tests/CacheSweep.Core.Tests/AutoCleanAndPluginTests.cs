using CacheSweep.Core.Automation;
using CacheSweep.Core.Plugins;
using CacheSweep.Core.Rules;
using Xunit;

namespace CacheSweep.Core.Tests;

public class AutoCleanSchedulerTests
{
    private static AutoCleanSettings Settings(
        bool enabled = true,
        string frequency = "daily",
        string time = "03:00",
        DateTimeOffset? lastRun = null)
        => new()
        {
            Enabled = enabled,
            Frequency = frequency,
            TimeOfDay = time,
            LastRunUtc = lastRun,
        };

    [Fact]
    public void Disabled_IsNeverDue()
    {
        var now = new DateTimeOffset(2026, 3, 10, 12, 0, 0, TimeSpan.Zero);
        Assert.False(AutoCleanScheduler.IsDue(Settings(enabled: false), now));
    }

    [Fact]
    public void NeverRun_IsNotDueBeforeTheScheduledTime()
    {
        var now = new DateTimeOffset(2026, 3, 10, 2, 30, 0, TimeSpan.Zero);
        Assert.False(AutoCleanScheduler.IsDue(Settings(time: "03:00"), now));
    }

    [Fact]
    public void NeverRun_IsDueOnceTheScheduledTimePasses()
    {
        var now = new DateTimeOffset(2026, 3, 10, 3, 1, 0, TimeSpan.Zero);
        Assert.True(AutoCleanScheduler.IsDue(Settings(time: "03:00"), now));
    }

    [Fact]
    public void Daily_NotDueTwiceInTheSameDay()
    {
        var lastRun = new DateTimeOffset(2026, 3, 10, 3, 5, 0, TimeSpan.Zero);
        var now = new DateTimeOffset(2026, 3, 10, 15, 0, 0, TimeSpan.Zero);

        Assert.False(AutoCleanScheduler.IsDue(Settings(lastRun: lastRun), now));
    }

    [Fact]
    public void Daily_DueAgainTheNextDay()
    {
        var lastRun = new DateTimeOffset(2026, 3, 10, 3, 5, 0, TimeSpan.Zero);
        var now = new DateTimeOffset(2026, 3, 11, 3, 5, 0, TimeSpan.Zero);

        Assert.True(AutoCleanScheduler.IsDue(Settings(lastRun: lastRun), now));
    }

    [Fact]
    public void Daily_CatchesUpAfterAMissedDay()
    {
        var lastRun = new DateTimeOffset(2026, 3, 8, 3, 5, 0, TimeSpan.Zero);
        var now = new DateTimeOffset(2026, 3, 12, 10, 0, 0, TimeSpan.Zero);

        Assert.True(AutoCleanScheduler.IsDue(Settings(lastRun: lastRun), now));
    }

    [Fact]
    public void Weekly_WaitsSixDays()
    {
        var lastRun = new DateTimeOffset(2026, 3, 10, 3, 5, 0, TimeSpan.Zero);

        var threeDaysLater = new DateTimeOffset(2026, 3, 13, 4, 0, 0, TimeSpan.Zero);
        Assert.False(AutoCleanScheduler.IsDue(
            Settings(frequency: "weekly", lastRun: lastRun), threeDaysLater));

        var sevenDaysLater = new DateTimeOffset(2026, 3, 17, 4, 0, 0, TimeSpan.Zero);
        Assert.True(AutoCleanScheduler.IsDue(
            Settings(frequency: "weekly", lastRun: lastRun), sevenDaysLater));
    }

    [Fact]
    public void Monthly_WaitsAboutAMonth()
    {
        var lastRun = new DateTimeOffset(2026, 3, 1, 3, 5, 0, TimeSpan.Zero);

        var tenDaysLater = new DateTimeOffset(2026, 3, 11, 4, 0, 0, TimeSpan.Zero);
        Assert.False(AutoCleanScheduler.IsDue(
            Settings(frequency: "monthly", lastRun: lastRun), tenDaysLater));

        var thirtyDaysLater = new DateTimeOffset(2026, 3, 31, 4, 0, 0, TimeSpan.Zero);
        Assert.True(AutoCleanScheduler.IsDue(
            Settings(frequency: "monthly", lastRun: lastRun), thirtyDaysLater));
    }

    [Fact]
    public void MalformedTime_FallsBackToThreeAm()
    {
        var before = new DateTimeOffset(2026, 3, 10, 2, 0, 0, TimeSpan.Zero);
        var after = new DateTimeOffset(2026, 3, 10, 4, 0, 0, TimeSpan.Zero);

        Assert.False(AutoCleanScheduler.IsDue(Settings(time: "not-a-time"), before));
        Assert.True(AutoCleanScheduler.IsDue(Settings(time: "not-a-time"), after));
    }
}

public class AutoCleanScopeTests
{
    [Theory]
    [InlineData("user-temp")]
    [InlineData("plugin-browser-edge-cache")]
    [InlineData("plugin-game-nvidia")]
    public void CacheOnlyRules_AreEligible(string id)
    {
        Assert.True(AutoCleanScope.IsEligible(id));
    }

    [Theory]
    [InlineData("recycle-bin")]
    [InlineData("pnpm-store")]
    [InlineData("pnpm-store-alt")]
    [InlineData("plugin-wechat-images")]
    [InlineData("plugin-qq-files")]
    [InlineData("plugin-dev-npm")]
    public void RulesThatCanHoldUserData_AreNotEligible(string id)
    {
        Assert.False(AutoCleanScope.IsEligible(id));
    }

    [Theory]
    [InlineData("thumbnail-cache")]      // held open by explorer.exe
    [InlineData("windows-temp")]          // needs admin
    [InlineData("windows-update-cache")]  // needs admin
    [InlineData("windows-cbs-logs")]      // needs admin
    public void RulesThatNeedAdminOrAreLocked_AreNotEligible(string id)
    {
        // A background job must not report failures it cannot fix without
        // elevation or closing the shell; those stay in the manual flow.
        Assert.False(AutoCleanScope.IsEligible(id));
    }

    [Fact]
    public void EveryEligibleId_IsUnique()
    {
        var ids = AutoCleanScope.EligibleIds.ToList();
        Assert.Equal(ids.Count, ids.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }
}

public class PluginCatalogTests
{
    [Fact]
    public void Catalogue_IsNotEmpty()
    {
        Assert.NotEmpty(PluginCatalog.All);
    }

    [Fact]
    public void PluginIds_AreUnique()
    {
        var ids = PluginCatalog.All.Select(p => p.Id).ToList();
        Assert.Equal(ids.Count, ids.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [Fact]
    public void RuleIds_AreUniqueAcrossPlugins()
    {
        var ids = PluginCatalog
            .All
            .SelectMany(p => p.Rules)
            .Select(r => r.Id)
            .ToList();

        Assert.Equal(ids.Count, ids.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }

    [Fact]
    public void InstalledPlugins_ContributeRulesAndUninstalledDoNot()
    {
        var preferences = new UserPreferences();
        var withoutPlugins = BuiltInRules.Load(preferences);
        var withoutIds = withoutPlugins.Select(t => t.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);

        Assert.DoesNotContain("plugin-browser-edge-cache", withoutIds);

        preferences.InstalledPlugins.Add("browser");
        var withPlugins = BuiltInRules.Load(preferences);
        var withIds = withPlugins.Select(t => t.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);

        Assert.Contains("plugin-browser-edge-cache", withIds);
        Assert.True(withPlugins.Count > withoutPlugins.Count);
    }

    [Fact]
    public void DisabledPlugin_ContributesNothing()
    {
        var preferences = new UserPreferences();
        preferences.InstalledPlugins.Add("browser");
        preferences.DisabledPlugins.Add("browser");

        var targets = BuiltInRules.Load(preferences);
        Assert.DoesNotContain(targets, t => t.Id.StartsWith("plugin-browser-", StringComparison.Ordinal));
    }
}
