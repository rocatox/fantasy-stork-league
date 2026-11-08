# Operational monitoring

The production Worker checks operations every 15 minutes alongside the existing
sync timer. Monitoring uses a separate authenticated self-request so it does not
add work to player requests or share the sync handler's CPU budget. No new paid
service, database, cron schedule, or GitHub workflow is required.

## Checks

| Check | Threshold |
| --- | --- |
| Backups | No verified backup workflow completion in 30 hours |
| Study imports | Any of the eight approved studies lacks a success within its normal interval plus 90 minutes: 2.5 hours racing, 7.5 hours off-season |
| Storage | Each bound database: prepare at 350 MB, expand at 400 MB, critical at 450 MB; unavailable size is an unknown condition |
| Email | Warning at 100 pending messages or oldest at least one hour; critical at 500 messages, oldest at least 24 hours, or failed/uncertain deliveries created in the last 24 hours |

Backup checks use GitHub Actions read access through the existing sync token.
A successful workflow with a skipped capture job does **not** count. The named
capture/restore-check/encrypt/upload step must have succeeded in a successful
job. This is evidence of the workflow's verified upload, not a fresh independent
download or a guarantee that someone has not subsequently deleted a Drive file.
Manual verified backups also count as recovery points. Retention remains the
backup workflow's responsibility.

Checks require two consecutive abnormal observations before notifying. Unchanged
incidents remind at most once per 24 hours; changed severity produces a new
notice after two samples. Two healthy observations produce a recovery notice.
Unknown telemetry never counts as healthy. Overlapping runs are leased, with a
10-minute minimum between samples; queued alerts and state commit atomically.

## Owner alerts and free limits

Alerts go only to the existing `BUG_REPORT_EMAIL`, using the Brevo sender and
shared delivery lease, cooldown, idempotency keys and attempt budget (270/day,
8,100 over the existing rolling window). They are separate from player channel
preferences and do not change those preferences or batch player emails. One
monitoring message may contain several operational conditions found together.
Operational messages have priority over player mail, but deduplication limits
their volume. Pending alerts expire after two days, diagnostics after 30 days.
Ambiguous sends are not retried beyond the provider's safe idempotency window.

Email allowance exhaustion, provider outages, a stopped Worker timer, or a main
database outage can delay/prevent alerts. This is **not an independent uptime
monitor**. Keep GitHub's native workflow-failure notifications enabled as an
additional channel; they cannot detect a workflow that never starts. No monitor
can claim successful delivery until the provider accepts it, and acceptance is
not inbox receipt.

## Private diagnostics and controls

`OPERATIONS_ENABLED=true` enables sampling and alert delivery. Disabling it does
not disable syncing or player notifications. The owner address and Brevo key
remain hosted secrets. No credentials, locations, league names or account details
are included in operational alerts or public health output.

`GET /api/operations` requires `Authorization: Bearer <SYNC_SECRET>` and returns
the last private sample plus email status counts. `POST` with the same credential
requests a sample (still subject to the minimum interval); it can queue genuine
alerts. Do not put the secret in URLs, logs, GitHub artifacts or chat. Migration
0018 creates only the operational state/queue tables. Recovery drill configuration
disables operations and blocks this endpoint.

`node tests/operational-monitor.mjs` uses isolated SQLite and mocked GitHub/Brevo.
It covers thresholds, racing/off-season intervals, skipped backups, unavailable
telemetry, concurrency, repeat suppression, recovery, shared budgets and stable
retry payloads. The existing email suite verifies player settings and unsubscribe
behavior remain unchanged. Never inject a synthetic incident into production to
test delivery.

## Production verification — November 7, 2026 (Eastern)

Migration 0018 and Worker `229d670a-5a3c-4ee7-9753-7ba5776bb77d`
were deployed at source revision `6a25191`. The first naturally scheduled check
ran at 2026-11-08 04:11:35 UTC (11:11 p.m. Eastern): all six checks were healthy.
It verified backup run 42428420981's capture step completed at 00:12 UTC,
all eight study successes were current, and measured main 995,328 bytes,
archive 1 138,727,424 bytes, archive 2 40,960 bytes. Player/bug email pending
and recent terminal-failure counts were zero. No operational email was queued
or sent. This observes monitoring execution, not a new scheduled backup.

The full regression suite passed (179 unit tests plus integration suites,
including operational monitoring, email preferences and full-season scoring).
The production build passed. Unauthenticated monitoring access returned 401.
The frontend assets remained byte-for-byte the same build names as the keyboard
and focus rollback; no app UI files changed. Alert delivery/recovery and
simulated failures were tested only with mocked email, not live test messages.
