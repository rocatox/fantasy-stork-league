# Race-season capacity rehearsal — November 7, 2026

## Scope and safety

Executed locally with in-memory SQLite, synthetic birds/identities, simulated clocks, real snapshot/race/notification handlers and SQL triggers, and intercepted Clerk/Brevo HTTP. Unknown HTTP destinations throw. No live requests, credentials, cloud deployments, real leagues, emails, or paid resources were used. Existing functional season and email-setting suites also passed.

Run `npm run test:capacity` for the separate, deliberately slower capacity suite. Aggregate reports remain under ignored `.runner/race-capacity/`. Scenario fixtures begin with completed drafts: this suite measures race-season work, while `tests/full-season-rehearsal.mjs` covers drafting, trades, swaps, recovery, corrections and final results.

Each 24-hour case commits eight synthetic study snapshots each hour, claims/commits each unique drafted bird once per hour, and models the existing four-delivery callbacks on successful API requests, twelve-delivery quarter-hour pumps and six-message minute email pump. Eight birds receive simultaneous-timestamp arrivals in hour two. Subsequent hours repeat unchanged evidence. Accounts opt into both own and league-wide race emails to test the high-fan-out case. Managers are distinct across leagues; overlap refers to birds, not account memberships.

## Results

| Bird pool | Leagues / managers | Simulated hours | In-app jobs left | Emails accepted / pending |
| --- | --- | --- | --- | --- |
| 64 | 1 / 8 | 24 | 0 | 270 / 18 |
| 100 | 10 / 80 | 24 | 0 | 270 / 962 |
| 200 | 25 / 200 | 24 | 0 | 270 / 962 |
| 200, same 48 drafted everywhere | 50 / 400 | 3 | 5,780 | 0 / 0 — arrival events still behind earlier jobs |

All eight hourly snapshot imports and race commits completed in the tested cases. Race targets were deduplicated across leagues. Standings totals, notification IDs and accepted-email IDs were consistent; the configured daily cap was never exceeded. The separate full-season test reverified corrected arrivals, recovered birds, ties and final results. The email suite reverified the category/channel matrix, queued opt-outs, unsubscribe, retries and no duplicate sends.

**Email fan-out is significant even in one league.** Eight arrivals generate 36 bird-state changes as successive imports establish arrivals and revise prior finishers' points. With all eight managers requesting league emails, this creates 288 messages. These are distinct updates, not duplicate delivery of one event. Eighteen remain queued after the configured 270-attempt daily allowance. More recipients amplify this; retaining individual messages does not remove provider-budget delays or the existing 48-hour expiry policy.

**Overlapping leagues overload the in-app queue.** Fifty leagues sharing 48 birds generate 2,400 source jobs per hourly reconciliation, even when results are unchanged. With the current bounded pumps, 1,972 jobs remained after the first hour and 5,780 after the third. New arrival alerts had not yet reached fan-out, explaining the zero email count in that stress case. It is not evidence that the email toggle failed. Serial execution is optimistic about lock contention; real concurrency can lower throughput further.

**Write pressure grows before the HTTP query-count limit is reached.** Measured handler calls used at most 34 SQL statements in the tested 200-bird snapshots, 20 for notification delivery and 22 for email delivery. The 100-bird/10-league day nevertheless recorded 162,338 SQLite row changes, including triggers and setup, versus the project's documented 100,000/day free D1 write budget. This is a local pressure indicator, not Cloudflare billed-row telemetry: scans, index accounting and concurrent production work are not modeled. The 200-bird/25-league case recorded 383,273 local row changes. Per-request bounded work alone is insufficient.

Race claims also reread the complete ready-league collection. At 10 leagues the 2,400 daily claim calls returned roughly 1.22 GB of cumulative SQLite result JSON to the application. This is repeated local result materialization, not internet traffic or stored size. It identifies an avoidable scaling cost even though the SQL statement count stays low.

## Full-resolution history

A separate rehearsal used the real history endpoint with separate local main/archive databases. It wrote every monthly chunk, read/decompressed it, and compared every record. Twenty-four current-month read/merge/rewrite cycles retained the exact records without duplication. Synthetic timestamps cover January 16 00:00 Eastern through June 30 23:59 Eastern, including the DST offset change.

| Source cadence | Season fixes per bird | Compressed bytes per bird | 100-bird season payload | 200-bird season payload |
| --- | --- | --- | --- | --- |
| Every minute | 238,980 | 2,324,458 | 232.4 MB | 464.9 MB |
| Every five minutes | 47,796 | 474,289 | 47.4 MB | 94.9 MB |

These are synthetic payload projections, excluding existing archives, summaries/indexes, physical allocation and other data. Actual movement/identifier entropy affects compression. The five-minute case represents a transmitter's observation interval, **not** sampling protected current-season history. With approximately 139 MB of existing history in the last production audit, 200 one-minute reporters would not fit in the current single archive database. No retention protections were changed.

## Recommended next work

1. Reduce redundant race-notification work: unchanged observation checks should not copy and fan out full league snapshots. Preserve arrival/correction/migration-start events, baseline establishment and settlement milestones. Test interruption/replay before deployment.
2. Bound race claim/maintenance reads to the relevant target and leagues, avoiding repeated full-league JSON materialization.
3. Decide how to handle multiple standings changes from one import cycle before generating email. This would be an explicit behavior change; the rehearsal does not reintroduce digest batching or silently suppress corrections.
4. Rerun these cases after fixes, then measure a complete post-fix production UTC day. Before substantially growing dense history, implement and verify free D1 archive sharding with recovery coverage.

## Limits of the evidence

Node/SQLite elapsed and process CPU times are not Cloudflare Worker CPU measurements. The suite does not certify free-plan capacity or a safe user ceiling. It does not measure Movebank download latency, GitHub runner duration, concurrent browser activity, Cloudflare network latency, actual provider delivery, all-hourly archive workload for every bird, or full-resolution race export parsing at fleet scale. The dense history case and hourly race/snapshot fleet case are separate exercises. No production capacity claim should be based solely on their successful functional assertions.

## Optimization rerun - November 7, 2026 (isolated, not deployed)

Migration `0014_race_notification_changes.sql` preserves freshness/evidence writes while skipping race-update fan-out when notification-relevant values are unchanged. Initial inserts still establish baselines. Arrival evidence/version changes, migration-start changes, stale-data recovery and first full season-end coverage still enqueue durable snapshots. Settlement timers remain unchanged. No pending jobs are deleted/coalesced, and email batching, scoring and preference rules are unchanged.

Race claims select the requested pick from current completed leagues in SQL instead of reconstructing every target and returning full rosters. Replacement checks still run, scoped to that bird, so recovery clears its alert as before. Healthy birds without flags return no league JSON. Queue discovery and scheduled maintenance retain global checks. Empty notification callbacks return before writing a lock.

| Scenario | Local row changes before / after | Reduction | Claim result JSON before / after |
| --- | --- | --- | --- |
| 64 birds, 1 league, 24 hours | 30,537 / 11,815 | 61.3% | 81.5 MB / 0.99 MB |
| 100 birds, 10 leagues, 24 hours | 162,338 / 24,144 | 85.1% | 1,217.9 MB / 2.00 MB |
| 200 birds, 25 leagues, 24 hours | 383,273 / 42,999 | 88.8% | 6,031.3 MB / 3.96 MB |

These cases ended with no in-app source backlog. Accepted/pending emails were unchanged: 270/18 for one league, 270/962 for ten and twenty-five leagues. Local row changes are not billed D1 usage: SQL predicates still inspect league JSON; concurrent clients, scans, indexes and archive work require separate measurement.

The fifty-league overlap case ended with 1,380 queued source jobs, down from 5,780 (76.1%), after three hours. Its first-import baseline burst is retained to preserve behavior and still delays arrival fan-out. It is not yet a safe scale target. Dense-history round-trip results and storage projections were unchanged.

Validation: 174 unit tests and all integration suites passed; the production build passed with its existing large-bundle warning. Old/new triggers produced identical notification-account state through unchanged checks, stale recovery with withheld points, migration starts, arrival retraction/restoration, season coverage, final results and post-final correction. The migration simulation asserts a fresh unchanged repeat creates no source event, while replaying a saved real source snapshot remains deduplicated. Empty delivery asserts zero SQLite writes. Claim tests reject absent/future targets and prevent full roster/league materialization. Season and Brevo-mock suites preserve scoring, settings, actor exclusion, unsubscribe and retries.

Code and migration are prepared in the repository only. No production migration, deployment, credentials, real league writes or emails were performed. Apply the main-database migration before deploying the Worker when releasing this change; it is compatible with the existing writer. First-import overlap bursts, email allowance and dense archive growth remain separate constraints.

## Initial-import backlog rerun - November 7, 2026 (isolated, not deployed)

Migration `0015_race_initial_notifications.sql` preserves one first-import baseline per league and skips subsequent initial results only while the entire imported roster has no arrival or migration signal and the race has not ended. A first result carrying a signal always produces a job. Once any other roster result carries a signal, later first imports remain observable so that the last missing result can release withheld points. Initial post-season imports are also retained. Existing queued jobs are neither removed nor rewritten. This is not event coalescing, email batching or a scoring change.

The complete capacity suite was rerun with synthetic data, isolated local databases and mocked Clerk/Brevo HTTP. No production requests, deployment, migrations, credentials, real emails or paid resources were used.

| Scenario | Previous local row changes | New local row changes | Final in-app backlog |
| --- | --- | --- | --- |
| 64 birds, 1 league, 24 hours | 11,815 | 11,251 | 0 |
| 100 birds, 10 leagues, 24 hours | 24,144 | 18,504 | 0 |
| 200 birds, 25 leagues, 24 hours | 42,999 | 28,899 | 0 |
| 200 birds, 50 leagues sharing 48 drafted birds, 3 hours | 21,258 | 40,008 | 0, previously 1,380 |

The fifty-league case had no source backlog after hour one or hour three. The previous 2,400 neutral initial jobs become 50 league baseline jobs; later real arrivals remain distinct. The maximum observed backlog after callbacks fell from 2,244 to 340. Extra writes in this scenario are expected: meaningful alerts now reach all recipients rather than remaining blocked behind initial source work.

For this fully opted-in overlap case, every manager retained all 36 expected arrival/point-change notifications (eight arrivals plus intermediate scoring changes). That produced 14,400 email jobs: 270 mocked acceptances and 14,130 pending under the unchanged daily allowance. There were no duplicate notification IDs or accepted deliveries. This does not make 400 fully opted-in managers' email volume feasible on the free budget; delayed messages can still expire under the existing retention rules. The other scenarios retained exactly their previous accepted/pending email totals.

Validation: 175 unit tests and all integration suites passed, along with the production build (existing large-bundle warning only). New old/new comparisons verify identical account state for immediate and delayed background processing, neutral first imports, an arrival on the first import with points initially withheld, migration signals on first import, and initial post-season nonfinishers/final results. The migration preserves preexisting outbox rows. Previous tests continue covering corrections, stale recovery, settlement, partial delivery/replay, settings, unsubscribe and mocked email retries. Full-resolution history round trips were rerun without changing storage or retention rules.

These are local SQLite/Node measurements, not Cloudflare billed-row or CPU measurements. A first import already containing many real arrivals/migration signals intentionally retains its work and may still form a burst. Both pending main-database migrations (0014 then 0015) must be applied in order when releasing the changes; neither has been applied to production during this work.

## Production release - November 7, 2026

Released commit `e73379db2da031cf68bf73fdcd20be14ac37a708` as Worker version `5f5e29bf-bc6b-49d6-a168-a96b9e8ca9dc`. Main-database migrations 0014 and 0015 were applied in order before deployment. Read-only verification confirmed both installed trigger definitions exactly match the tested SQL. The earlier "not deployed" notes above describe the previous rehearsal state.

Before migration, a fresh private main-database snapshot (637 rows) was saved and restored locally with integrity and foreign-key checks passing. Both production database bindings, the custom domain, existing secrets, free-plan settings, quarter-hour sync/notification cron and minute email cron were retained. No test leagues, scoring results or notification events were inserted, and no test emails were sent.

Post-deployment [manual reconciliation run 42412592088](https://github.com/rocatox/fantasy-stork-league/actions/runs/42412592088) completed successfully from 20:45:41 to 20:52:17 UTC. This was explicitly `workflow_dispatch`, not a scheduled import:

- All eight approved studies actually imported; zero policy skips.
- All 36 bird histories succeeded, fetching 14,120 source events (including overlap/reconciliation records; not necessarily new observations). No retries, deferred histories or failures.
- All 36 migration rankings were republished and matched the pre-deployment baseline exactly.
- Race reconciliation succeeded with zero targets, as expected for the current off-season. All four stored league records and the empty live race-results table were unchanged. Scoring/notification edge cases are supported by the isolated 175-test plus integration suite, not a claim of a live race arrival during this check.
- Production health passed; notification queue and pending email queue were empty. Email attempt-budget records were unchanged from before deployment.
- Capacity check passed: main DB 925,696 bytes; history DB 138,727,424 bytes. Existing email allowance remained 270 daily / 8,100 rolling attempts. No plan upgrades or new paid resources.

Private backup, before/after records and workflow logs remain local under the access-restricted `.wrangler/private-backups/2026-11-07T20-43-27-154Z/`; no raw GPS or private league/account data was committed.

Automatic post-release verification: the production sync timer checked successfully at 20:56:35 UTC (`current`), and the notification maintenance/delivery tick completed at 20:56:37 UTC (`empty`, zero queued jobs). The minute email timer checked at 20:56:58 UTC (`idle`, zero jobs). No manual notification job or test send was used for this verification.


## Reconciled cycle notifications - November 7, 2026 (isolated, not deployed)

The race runner now opens an exclusive 25-minute notification cycle and closes it in a `finally` block after processing its targets. Migration 0016 atomically associates captured ready-league events with that cycle. Closing captures immutable per-league standings inputs and a terminal event in one database transaction. Existing queued events remain untouched. Delivery preserves the original arrival/retraction and migration sequence but takes points from the completed cycle when the arrival matches; it retains the existing pending/stale-data safeguards. Final results are emitted from the terminal snapshot. An interrupted runner expires after 25 minutes and is closed by the next delivery callback/timer (the quarter-hour fallback can add up to roughly 15 minutes). Late commits cannot modify a closed or expired cycle.

This changes notification timing, not scoring or email batching: individual arrival, migration and genuine correction messages remain separate. Race notifications wait for reconciliation rather than announcing provisional points after every bird import. A later cycle can still produce genuine points corrections. A retraction/restoration within a cycle remains observable. Unrelated leagues continue delivering while a cycle is open; per-league event order and recipient cursors prevent skipped or duplicated alerts. Drained snapshots are pruned at the next cycle start. No mail provider, preferences, send caps, history retention or paid resources changed.

| Scenario | Email jobs before / after | Mocked accepted / pending | Final source backlog | Local row changes before / after |
| --- | --- | --- | --- | --- |
| 64 birds, 1 league, 24 hours | 288 / 64 | 64 / 0 | 0 | 11,251 / 8,651 |
| 100 birds, 10 leagues, 24 hours | 1,232 / 288 | 270 / 18 | 0 | 18,504 / 16,951 |
| 200 birds, 25 leagues, 24 hours | 1,232 / 288 | 270 / 18 | 0 | 28,899 / 27,571 |
| 200 birds, 50 overlapping leagues, 3 hours | 14,400 / 3,200 | 270 / 2,930 | 0 | 40,008 / 19,423 |

The overlap case now gives each opted-in manager eight arrival messages with reconciled points instead of 36 arrival/intermediate-points messages, a 77.8% reduction. Its initial baseline/terminal burst leaves 48 source jobs after hour one, then drains fully by hour three; do not claim every initial callback has no backlog. Genuine changes still retain durable source events. Ten and twenty-five leagues have the same email totals in these fixtures because only eight targets arrive and the additional leagues do not all own those birds; this is not constant-volume scaling. Provider limits still prevent free same-day delivery of the large overlap burst, and the existing 48-hour expiry remains relevant.

Validation: all 175 unit tests and the SQLite integration suites passed, including the new cycle integration, full-season rehearsal and Brevo mocks. Production build and standalone race-runner bundle passed (existing app bundle-size warning). New checks cover rollback during close, idempotent close, partial recipient interruption/retry, immutable snapshots across overlapping queued cycles, expired-cycle recovery, ownership/late-write rejection, unrelated-league delivery, arrivals/retractions/restorations, migration signal persistence, later scoring corrections, both race notification toggles, no own-bird duplicates, final-results routing, and individual mocked delivery. The four capacity scenarios use the real cycle endpoints; no real HTTP destination or credentials are available. The dense-history round-trip suite remains unchanged.

Measured handler query maxima remain below 50 (34 for the largest snapshot import, 23 for notification delivery, 22 for email delivery, 7 for race claims, 6 for race commits, and 3 for closing a cycle). These local SQLite measurements do not establish Cloudflare CPU, billed rows, concurrency throughput or a safe production user ceiling. Diagnostic reports remain ignored under `.runner/`.

Release order: capture a private recovery point, apply main migration 0016, deploy the Worker, then publish the updated runner. Do not publish the runner before the Worker supports `cycle-begin`/`cycle-end`. This task performed no production migration, deployment, real-email send or plan change.


## Cycle-notification production release - November 7, 2026

Migration 0016 is now applied, followed by Worker `ddd2e52a-0ba6-47d5-ba2a-e329d2dc3528`; runner commit `d271d358b665985b0db3e1e24a0ae46a30cadeac` was pushed only after Worker/schema verification. The earlier isolated/not-deployed section records the test stage, not current release state. A new private main-database backup (647 rows) was restored locally with integrity/foreign-key checks passing before migration. No archive migration, plan upgrade, secret change or test-email send occurred.

[Manual verification run 42415311685](https://github.com/rocatox/fantasy-stork-league/actions/runs/42415311685) ran from 21:19:30 to 21:29:04 UTC and succeeded. Actual logs show eight study imports (zero skips), 36 successful histories, 36 published statistics, zero retries/failures/deferred work, successful race reconciliation, and a passed capacity check. All source success timestamps advanced. Final public rankings match the saved baseline for all 36 birds; all four stored league records and empty race-results table are unchanged. A temporary pending ranking while history was being rebuilt resolved before final verification.

The real runner opened and closed its new durable cycle at approximately 21:21 UTC. Production reconciliation had zero active race targets because it is off-season; live arrival/scoring fan-out was not exercised. Scoring, genuine corrections, migration/arrival preservation, category routing and duplicate prevention remain supported by the isolated cycle/season/mock-email tests. Installed cycle tables/indexes/trigger match migration 0016 exactly.

The automatic notification tick at 21:26:37 UTC completed empty, the minute email timer stayed idle, and the sync timer detected the running workflow instead of dispatching a duplicate. The full imports above were manually dispatched, not scheduled imports. Queue and email backlog were zero, there were no overdue studies, and email attempt counters remained unchanged (8 daily / 12 rolling). Capacity: main 950,272 bytes; history 138,727,424 bytes. Existing free-plan limits and production schedules remain unchanged.

Backup, logs, baseline comparison and deployment evidence are access-restricted and Git-ignored under `.wrangler/private-backups/2026-11-07T21-17-35-173Z/`. No raw GPS/account/league data was published.
