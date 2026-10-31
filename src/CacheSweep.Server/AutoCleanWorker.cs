using CacheSweep.Server.Api;

namespace CacheSweep.Server;

/// <summary>
/// Background tick that drives automatic cleanup.
///
/// The check runs every couple of minutes rather than sleeping until the exact
/// scheduled time: the app may be started long after the schedule, and a missed
/// moment should be caught up rather than skipped. <see cref="Core.Automation.AutoCleanScheduler.IsDue"/>
/// makes the decision, so the tick itself stays trivial.
/// </summary>
internal sealed class AutoCleanWorker : BackgroundService
{
    private static readonly TimeSpan TickInterval = TimeSpan.FromMinutes(2);

    private readonly SweepService _service;
    private readonly ILogger<AutoCleanWorker> _logger;

    public AutoCleanWorker(SweepService service, ILogger<AutoCleanWorker> logger)
    {
        _service = service;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the server finish starting before doing any disk work.
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var record = await Task.Run(_service.TickAutoClean, stoppingToken)
                    .ConfigureAwait(false);

                if (record is not null)
                {
                    if (record.Skipped)
                    {
                        _logger.LogInformation("Auto-clean skipped: {Reason}", record.Reason);
                    }
                    else
                    {
                        _logger.LogInformation(
                            "Auto-clean freed {Bytes} bytes across {Files} files ({Failures} failures)",
                            record.FreedBytes, record.DeletedFiles, record.Failures);
                    }
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                // A background task must never take the server down.
                _logger.LogWarning(ex, "Auto-clean tick failed");
            }

            try
            {
                await Task.Delay(TickInterval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
