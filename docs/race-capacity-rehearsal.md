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
