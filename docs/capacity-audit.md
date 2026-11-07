# Capacity and free-plan audit

Measured November 7, 2026, around 01:10 Eastern. Read-only production inspection; no subscriptions, quotas, data retention, or scheduler settings were changed. Figures are a snapshot, not a load-test capacity guarantee. Raw GPS, account records, credentials and report bodies were not exported.

## Findings

| Resource | Observed usage | Free allowance / implication |
| --- | --- | --- |
| Worker invocations | Approximately 24,625 over the preceding 24 hours | 100,000/day account-wide, resetting at midnight UTC; rolling snapshot is not the billing-day total |
| Worker resource failures | 28 `exceededResources` outcomes, about 0.11%; 19 client disconnects separately | Per-invocation resource pressure already exists. Daily request headroom does not resolve it |
| Main D1 size | 901,120 bytes | 500 MB per database |
| History D1 size | 138,854,400 bytes (138.85 decimal MB) | Approximately 28% of 500 MB; 361 MB remaining using a conservative decimal limit |
| Main D1 24-hour reads | 1,440,627 rows; 75,850 queries | Approximately 29% of the account-wide 5 million rows/day allowance |
| Main D1 24-hour writes | 4,686 rows; 3,972 queries | Approximately 4.7% of 100,000 rows/day |
| Archive D1 analytics | `d1 info` returned zero reads/writes despite the active archive | Treat as unavailable/inconsistent telemetry, not proof of zero consumption. Main database figures are a lower bound on total account use |
| GitHub Actions | Repository is PUBLIC; standard `ubuntu-latest` runner | Public standard runner compute is free; keep artifacts/cache bounded and never publish GPS/private data |
| Email | Four recorded attempts on Nov 6; zero pending player emails at inspection | App cap 90 attempts/day and 2,700 across its conservative lookback; provider free allowance 100/day, 3,000/month |
| Clerk | Three notification-account rows, not a count of Clerk users | Published free allowance is 50,000 monthly retained users. Clerk dashboard usage/plan was not independently checked |

The app has 36 live birds, four stored leagues (not necessarily all active), and two private bug reports. `/api/health` returned healthy, empty notification/email queues, and a current sync slot. Provider billing settings and other projects' account-wide usage were not verified; this audit does not certify a zero invoice. Domain registration/renewal remains a separate expense.

## Storage scaling

The archive contains 2,527 bird-months and 9,940,874 retained observations. Of these monthly chunks, 2,394 are marked sampled. Chunk payloads total 116,248,141 bytes, plus 3,353,651 bytes in ten multipart rows. Physical database size includes summaries, indexes and allocation overhead. Do not add payload totals to the physical total.

Average chunk payload per bird is 3.23 MB; the largest is 8.10 MB, excluding multipart allocation. Current physical storage averages 3.86 MB per live bird. At the same history mix, 100 birds would occupy roughly 386 MB and 130 roughly 501 MB, before additional seasons and allocation changes. These are planning scenarios, not safe bird limits: dense transmitters and protected full-resolution seasons can grow much faster.

September chunk payload is 1.56 MB, October 2.10 MB, and partial November 0.34 MB. These are stored monthly cohorts, not measured net database growth. Older cohorts have been sampled, so extrapolating them to a full-resolution race season would understate demand.

Existing retention preserves recent 30-day data, protected season data and pinned race evidence; eligible older data uses five-minute sampling. Keep those safeguards. Recommend warning at 350 MB and planning expansion by 400 MB. Free D1 permits ten databases and 5 GB total, but this app currently routes archives to one binding: adding another requires explicit routing/migration work, not just creating a database. No R2 is required for that option.

## Runtime and query risks

Cloudflare aggregate analytics recorded 28 resource-limit failures. Aggregate data does not identify their endpoint or prove CPU versus another resource limit. A failed Nov 6 workflow ended with `Statistics API HTTP 503`; do not assert it was one of those 28 without correlated logs. The subsequent scheduled recovery and latest Cloudflare run succeeded. Latest run 42341666525 completed imports, race reconciliation, history, and statistics in about 5 minutes 40 seconds.

Code paths worth optimizing first:

1. `getBirds()` rereads/parses the complete roster and performs pairwise ring comparisons, including for each history request. Replace repeated work with revision-aware public-data caching and a linear ring index.
2. Rankings scan all historical monthly summaries and recompute seasons on demand. Persist derived rankings after successful statistics processing or cache by data revision. Keep arrival validation and scoring unchanged.
3. Public JSON currently uses `Cache-Control: no-store`; Scout's new cache is per browser session, not shared server caching. Add bounded caching only to public roster, rankings and history responses. Never cache private leagues, accounts, lists or notifications publicly.
4. Roster and league polling runs every minute, including hidden tabs; notification polling already checks visibility. Pause hidden-page polls, deduplicate across tabs where practical, and use slower off-season refresh with immediate refresh on return. Even a two-request-per-minute idle tab adds 2,880 requests/day; roughly 26 such tabs could consume today's remaining request allowance, before notifications/history. This is an illustrative request budget, not a concurrent-user limit.
5. Review league scans, notification settlement work and query counts per invocation before scaling managers. Free Workers have a 10 ms CPU allowance, 50 subrequests, and D1 documents 50 queries per invocation. Separate bounded jobs and indexed queries matter even below daily quotas.

Race imports run hourly rather than every six hours: a sixfold increase in scheduled import frequency, not necessarily sixfold total traffic. Do not multiply today's whole usage by six; interactive testing/polling, fixed cron work, imports and history processing have different drivers. Measure them separately before setting a player capacity promise.

## Email and retained state

Email is likely the first player-facing quota: 90 app attempts/day includes retries and owner bug reports. Three messages/day to 30 opted-in managers consumes that budget, though batching up to ten nearby events can reduce sends. A final-results burst to 100 managers cannot all fit in one day's app allowance. Player emails older than 48 hours expire; in-app notifications remain independently available. Provider usage outside this app is not reflected in its counter.

In-app events retain at most 200/account for 90 days; email deduplication data is pruned after 91 days. Bug reports cap at 5,000 stored records, five/account/day and 100/day overall. These protect growth, but completed league/race retention and archive growth still need review. The existing free D1 seven-day Time Travel window is not a substitute for the outstanding isolated backup/restore drill.

## Recommended next work

1. Diagnose resource-limit endpoints with sanitized route/status/CPU telemetry; optimize roster and rankings before expanding the pool.
2. Reduce hidden-tab and off-season polling, then compare a full UTC day of Worker and BOTH database metrics. Suggested review thresholds: 50,000 Worker requests, 2.5 million D1 rows read, 50,000 rows written, any sustained resource-limit failures, or archive size above 350 MB.
3. Run an isolated race-frequency capacity rehearsal including dense histories and notification fan-out. No real leagues, real emails or production load test.
4. Track storage daily before deciding whether a second archive shard is needed; keep free plans and current retention protections.
5. Complete a private backup/restore drill. Document email delays honestly rather than silently upgrading a provider.

## Official limits checked

- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/): static asset requests are free; Worker/API executions are metered.
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Resend pricing](https://www.resend.com/pricing?product=transactional)
- [Clerk pricing](https://clerk.com/pricing)

## Resource remediation and remeasurement — November 7, 2026

Deployed bounded public caching and reduced recurring polling; hosting plans and production timer remain unchanged. Only anonymous roster and rankings GET responses enter the shared edge cache, for 60 seconds. Private responses, writes and failures are excluded; drafting and swapping still check current database state. Cache hits still count as Worker invocations, but bypass database work. Cache entries are local to Cloudflare locations, so a different location can require a cold load.

Removed portrait allocation writes from unchanged roster reads, replaced pairwise ring matching with a linear index, reused the Eastern-time formatter, and trimmed rankings evidence returned by SQL without changing arrival rules. Migration-summary writes no longer retrieve and discard the compressed archive to locate its database. Binary history transport now uses native base64 conversion instead of per-byte JavaScript work.

Recurring roster, league and notification polls stop while hidden and resume on return, with overlapping focus events coalesced. Roster/league refresh stays at one minute during races or on My leagues, and changes to five minutes elsewhere off-season. Opening another page refreshes immediately. The five-minute cadence reduces those recurring off-season calls by 80%; hidden recurring calls stop entirely. These are schedule reductions, not measured reductions in total production traffic.

Verification:

- Full suite passed: 163 unit tests and the SQLite integration suites, including the isolated season rehearsal. Build and focused polling/cache checks passed after the final refinements.
- All 36 public roster records and all 36 rankings matched the saved baseline exactly.
- Controlled warm-cache requests used 0–1 ms CPU after the initial invocation; baseline ordinary roster/rankings requests observed roughly 7–17 ms. Final trace also recorded a 9 ms first cached roster request, a 30 ms rankings cache miss and 28–29 ms private league requests. Therefore caching does not eliminate cold-request or private-endpoint CPU risk.
- Cloudflare analytics for 06:22–06:30 UTC reported 62 requests, zero errors/resource-limit outcomes and 48 subrequests. This small window includes controlled probes and is not comparable to a full day's organic traffic. Network timings were noisy and are not evidence of a latency improvement.
- Historical endpoint-level telemetry access returned HTTP 403. Aggregate historical resource failures cannot be conclusively attributed to a route or to CPU alone. The concrete expensive paths above are fixed, but elimination of every historical failure remains unverified.

Final deployment: `306987fc-9e54-4d27-bcab-765cbb533754`. Sanitized traces and private baseline snapshots remain local under ignored `.wrangler/`; no GPS evidence was committed or uploaded. Next capacity measurement should cover a full post-deployment UTC day for Worker outcomes and both D1 databases. Continued cold-ranking/private-league spikes warrant precomputed derived rankings and bounded league-read work if resource failures recur. No paid services, real-email tests or changes to real leagues were introduced.

## Cold requests and private league reads — second pass, November 7

Deployment `294c1883-42c1-49ba-baf5-54b0d2f8b034` scopes GET-time maintenance and league selection to the authenticated member in SQL. Global scheduled maintenance remains global; writes retain their existing checks. Replacement checks skip the bird scan when no relevant draft/ready leagues exist and use an ID map instead of repeated roster searches. Session verification still runs on every private request. A Worker-local Clerk client is reused, and only manager display names/avatars are cached for 60 seconds (bounded to 512 entries). Name/avatar edits can therefore take up to one minute to appear in league displays; no membership, permissions, session results, trades or standings are cached.

Rankings now retrieve compact monthly tuples grouped by live bird instead of thousands of row objects with repeated field names. Every month, pending-version marker and archive-over-legacy precedence is preserved. No arrival or scoring algorithm changed. This requires no new database, schema migration or paid service.

Validation: all 164 unit tests and all SQLite integration suites passed, including the eight-manager rehearsal (312 race-event assertions, synthetic identities and mocked emails). Added tests verify profile cache expiry/eviction/failure behavior, scoped reads versus global expiry, and ranking/profile agreement over 25 synthetic years including late arrivals, missing evidence, invalid summary versions and overlapping archive stores. The production roster and rankings matched the saved baseline for all 36 birds. Live signed-in browsing loaded both leagues and the trading league's seven/five-bird rosters and controls; no real trade or swap was submitted.

Measurements from two short post-deployment trace windows:

- Rankings cache misses: 23 ms and 16 ms CPU, versus 30 ms in the preceding deployment's trace. Hits were 0–1 ms after the initial invocation. These are individual observations, not a controlled percentile benchmark.
- Private league reads: first observed 25 ms, then 14 ms and two 7 ms reads; preceding trace had 28–29 ms reads. Cold authentication/profile loading remains a cost; do not promise every request is below 10 ms.
- Analytics 06:36–06:39:20 UTC: 89 requests, all successful, zero reported resource-limit errors. Short window, includes testing and may include telemetry lag; not a full-day reliability or capacity claim.

Remaining risk: cold requests can still exceed the nominal CPU budget even when Cloudflare currently allows the invocation to complete. This pass reduces recurring work and demonstrated lower repeat-read CPU; it does not prove permanent elimination of resource-limit failures. A complete post-deployment day and more cold-start samples are still needed. Further reduction, if required, should move derived rankings into a revisioned precomputed read model and separately profile authentication versus league assembly. Diagnostics and any private evidence remain local; free plans and the retired original app remain unchanged.

## Precomputed rankings and authentication investigation — November 7

Rankings now use a per-bird derived record in the existing main D1 `sync_state` table. The public reader uses one small roster/status join and never scans migration archives, calculates seasons, or parses full bird profiles. The existing 60-second edge cache remains. History writes invalidate the record before changing evidence; completion/release rebuilds it under the existing history lease. The statistics runner explicitly publishes it before reporting `statistics-complete`. Cleanup deletes it. Rules/representation versions and future-observation timestamps guard against serving an obsolete calculation. Missing or invalidated records are marked pending, not treated as confirmed zero performance; visible-page refreshes retry pending rankings. Edge-cached responses can retain their prior value for the existing maximum 60-second lifetime.

A staged deployment kept the old reader running while all 36 records were generated through authenticated, lease-protected endpoints. Every result matched the old reader exactly before cutover. Generation remains per bird to bound Worker work; no additional database, paid service or scheduler was introduced. If ranking fields or their calculation changes, bump `RANKING_VERSION` (or the migration rules version) and rebuild before cutover. Arbitrary manual SQL changes to history must also invalidate/rebuild derived records; ordinary history API writes do this automatically.

The full 164-unit-test suite and integration/rehearsal suites passed. Additional checks cover rejecting invalid leases, archive precedence, 25 years of synthetic profile/ranking parity, version mismatch, write invalidation, publication on release, and ensuring ranking reads never query `history_chunks`. History and lifecycle integration tests were rerun after narrowing the roster query. Production signed-out reads returned no leagues and an invalid token was rejected with HTTP 401. Signed-in league browsing remained available. No real league mutations or emails were used for verification.

Authentication investigation: the installed Clerk SDK already caches remote signing keys within a warm isolate. Temporary, identity-free phase timings measured authentication at 15–17 ms elapsed, maintenance at 42–75 ms, profile lookup at 71–78 ms and standings lookup at 8–9 ms in the sampled requests. These are wall times, not separately attributable CPU times. [Clerk supports networkless verification with a configured public key](https://clerk.com/docs/reference/backend/authenticate-request), but pinning a key would introduce rotation/revocation maintenance. We retained SDK verification, authorized-party restrictions, signature/expiry checks and automatic key refresh; session verification is not cached. The diagnostic flag is disabled in production, and tokens, user IDs and GPS never enter the diagnostic output.

The first precomputed cache miss (before the final minimal-roster join) used 11 ms CPU, compared with 16–23 ms in the prior pass; hits used 0 ms. Cold private league requests still occasionally reached 27 ms, while warmed reads measured 5 ms. Precomputation addresses the rankings calculation spike; it does not eliminate every cold authentication or unrelated endpoint spike. Short trace samples are not a reliability guarantee or a full-day capacity measurement.

Final deployment `e9d3fe8d-a380-4746-98e9-644570e3bdaf`: the observed rankings cache miss used **7 ms CPU / 36 ms wall time**, followed by **0–1 ms CPU** hits. All 36 rankings again matched the baseline, anonymous reads returned zero leagues, and the invalid-token probe returned 401. This is an uncached endpoint sample, not proof of a brand-new isolate on every request. Other endpoint spikes remain visible (including a notification read), so do not describe the whole app as free of CPU-limit risk.

## Storage growth, runner costs and email batching — November 7

Deployment `913be61d-d751-4e29-86d8-730b91199d3d` adds a private `/api/capacity` POST, authenticated by the existing sync secret. Each sync workflow records main/archive sizes from D1 `meta.size_after`, shared email attempt totals and pending-email age. At most 30 daily samples are retained (one per UTC day); no GPS, report text, recipients or account identifiers appear in output. Missing size telemetry produces a warning instead of a false zero. Live verification measured main 913,408 bytes and history 138,854,400 bytes; email usage was zero attempts today, four across the existing rolling budget and zero pending player emails.

Storage warnings occur at 350 MB (review), 400 MB (expand) and 450 MB (critical; capacity-check step fails). These are early-warning thresholds, not extra storage and not a hard cap on imports. Nothing automatically deletes history, reduces protected resolution, provisions paid storage or changes the race evidence rules. The archive still has a 500 MB free per-database limit. Before materially expanding the bird pool, use measured growth and dense-season estimates, not the 386 MB/100-bird average alone.

Free expansion runbook: prepare a second D1 archive within the account-wide free limits; add explicit shard routing and all-shard reads to history, retention, cleanup and ranking rebuilds; copy one bounded bird at a time under its history lease; verify decoded records and metadata before pruning its old copy; test interrupted migrations, partial writes, ranking parity and recovery from a private backup. Provisioning a second binding alone is insufficient. Do this by the 400 MB warning or earlier if measured growth requires it. No second database was provisioned in this change. A full backup/restore drill and multi-shard implementation remain future work.

The GitHub repository was confirmed public. The sync job remains on standard `ubuntu-latest` and now explicitly requires a public repository; changing visibility will skip this workflow and requires reviewing sync/hosting costs rather than silently relying on private-repository minutes. No GPS artifacts or new large caches were introduced. [GitHub documents standard public-repository runners as free](https://docs.github.com/en/billing/concepts/product-billing/github-actions); larger runners are not covered by that exemption.

Routine player email now waits 15 minutes from the first queued update and combines up to ten available updates for that recipient. A new queue-receipt timestamp prevents delayed GPS/event timestamps from bypassing the wait. Draft turns (`Your pick`), new trade proposals, replacement opportunities and deadline reminders bypass this intentional delay and are prioritized within a batch. Such an email may also carry nearby routine updates, avoiding a second message. Actual delivery can still wait for the processor, provider or budget. Owner bug-report emails wait 15 minutes but remain separate to preserve full report details. In-app notification timing and toggles are unchanged.

The 90-attempt/day and 2,700-attempt conservative rolling caps remain shared by player and owner-report emails, including retries. Provider quotas are not increased; a burst to more than 90 distinct recipients still cannot all fit in one day. Existing opt-in checks, verified addresses, obsolete-action cancellation, unsubscribe, idempotent retries and 48-hour player-email expiry remain. Capacity warnings appear at 80% of either app budget or a player backlog at least 24 hours old. No real test emails were sent.

Validation: 168 unit tests and all integration suites passed, including the full synthetic season, digest timing, backdated enqueue timestamps, the four immediate categories, trade notification ownership, channel toggles, unsubscribe and shared free caps. Capacity integration verified authentication, real SQL persistence and daily-history bounds. Build passed. Migration `0013_email_digest.sql` is additive and was applied successfully; an initial transient Cloudflare authorization error cleared on retry after the existing session was verified.

Brevo cutover (November 7): production email capacity is now guarded at 270 attempts/day and 8,100 rolling attempts, with no digest batching. Individual messages and a six-job-per-tick drain replace ten-update digests for Brevo. The configured provider controls the capacity warning thresholds. Resend credentials/DNS and legacy provider-pinned retries remain intact. See email-notifications.md for retry limitations and live delivery/unsubscribe verification.

November 7 retirement follow-up: Brevo is now the sole sender; removed Resend credentials, DNS and runtime branches. Capacity defaults and warnings use 270 daily / 8,100 rolling attempts. No paid services were added. Historical Resend limits above do not describe the current configuration.

## Current review after Brevo retirement — November 7, 12:40 Eastern

Fresh measurements supersede the opening snapshot. No hosting plans, notification preferences, sender timing or retention rules changed during this review. The existing capacity endpoint refreshed its single daily aggregate sample.

- Main DB: 921,600 bytes; archive: 138,739,712 bytes (138.7 decimal MB, 27.7% of the conservative 500 MB database limit).
- Both databases now returned nonzero 24-hour telemetry: main 1,032,349 reads / 5,932 writes; archive 375,388 reads / 3,103 writes. Combined: 1,407,737 reads (28.2% of 5 million) and 9,035 writes (9.0% of 100,000). These rolling windows are not the UTC billing-day counter and exclude other account projects.
- Worker rolling 24-hour analytics: 21,246 requests, including 28 exceededResources outcomes and 16 client disconnects. The narrower 12:00–17:39 UTC window returned 1,993 successful requests and no errors/resource failures. The longer window includes earlier deployments; do not attribute all 28 to current code or claim a complete post-fix day has passed. Historical route attribution remains unavailable.
- Email: 8 charged attempts today / 270 app cap, 12 / 8,100 rolling cap; zero pending player emails. Brevo publishes 300 free daily sends; the app keeps safety headroom. All six notification categories remain individual emails, without batching.
- Latest three sync workflows completed successfully, including the 17:11 UTC Cloudflare-triggered run. Repository remains PUBLIC on standard ubuntu-latest. No new paid runner or storage was added.
- Capacity history still has only one UTC date, so there is not yet a defensible daily growth trend or time-to-full estimate.

Remaining priorities:

1. Email recovery and burst throughput: ambiguous sends stop retrying after 14 minutes, while the reliable fallback timer runs every 15 minutes. A timeout can therefore miss its safe retry opportunity. Improve bounded retries inside the safe window; never simply extend it or change keys to force delivery. At six messages per tick, timer-only throughput is at most 24/hour, before retries/skips. A 100-message burst takes 17 ticks (about four hours); event-triggered pumps can help but should not be assumed. Model league-wide alert fan-out rather than managers alone: an eight-bird arrival burst in an eight-manager league can produce 64 emails if every manager enables league updates. Shared daily caps and 48-hour expiry still matter with Brevo.
2. CPU reliability: retain cache/precomputed rankings/private-read improvements; gather a complete post-fix UTC day and correlate any new resource failures with sanitized endpoint traces. Cold private/notification paths remain the next profiling targets.
3. Isolated race-frequency/load rehearsal: hourly imports, dense protected full-resolution season history, many leagues and notification bursts. Existing functional eight-manager rehearsal is not a production-capacity guarantee.
4. Private backup/restore drill for both D1 stores and current code/config, followed by measured storage-growth planning. Archive sharding remains unimplemented; prepare by 350 MB and complete before 400 MB or sooner if growth requires it. No need to reduce protected race evidence or pay for R2 now.

Limits rechecked: Cloudflare Workers pricing, D1 pricing/limits, Brevo Free-plan FAQ, GitHub Actions billing and Clerk pricing. Clerk's published 50,000 monthly retained-user allowance is not a verified account dashboard reading. Current measurements support continued free-plan operation, not unlimited capacity or a guaranteed zero invoice for unrelated account services.

Email timing follow-up: a separate minute cron now drains up to six messages per tick and retries within the safe provider window. Isolated testing drained 100 messages in 17 ticks; no batching or higher send budget. Idle checks add about 1,440 cron invocations / 1,440 heartbeat writes daily, with no outbound email-job requests. This replaces the prior roughly four-hour timer-only burst estimate with roughly seventeen minutes under healthy conditions. Account-wide request/query/CPU monitoring and full race-frequency capacity testing remain outstanding.


## Isolated race-season capacity rehearsal � November 7

The [capacity rehearsal](race-capacity-rehearsal.md) completed 24 simulated hourly cycles at 64/100/200 birds and 1/10/25 leagues, plus a 50-league overlap stress case. No live requests, emails, deployment or plan changes were made. Functional checks passed, but scaling findings remain: redundant per-league notification work, write pressure, repeated race-target scans, email fan-out and dense-season archive growth. Fifty overlapping leagues left 5,780 in-app source jobs queued after three hours. Even one fully opted-in eight-manager league produced 288 emails from eight arrivals and their intermediate point changes, exceeding the configured 270/day app allowance. See the report for local-measurement limits; this is not a production capacity guarantee.


November 7 isolated optimization rerun: unchanged race notifications and empty delivery lock writes are suppressed, and claims use target-scoped reads. The 200-bird/25-league day fell from 383,273 to 42,999 local SQLite row changes with unchanged email totals. The 50-league first-import burst still leaves 1,380 source jobs after three hours. Code/migration are tested but not deployed. See the optimization rerun in [the capacity rehearsal report](race-capacity-rehearsal.md). Local measurements are not Cloudflare billed usage.


Initial-import follow-up (isolated, not deployed): retaining one neutral baseline per league eliminated the tested 50-league initial source backlog (1,380 to zero after three hours). Real arrivals still generated all 14,400 email jobs, limited to 270 mocked acceptances. The 200-bird/25-league day now records 28,899 local row changes. Migration 0015 follows pending 0014; see the latest [capacity rehearsal results](race-capacity-rehearsal.md). No production resources or sending settings changed.


Production release completed November 7: migrations 0014/0015 and Worker 5f5e29bf-bc6b-49d6-a168-a96b9e8ca9dc are live. Manual verification run 42412592088 imported all eight sources, updated all 36 histories and republished unchanged rankings; the subsequent automatic 20:56 UTC timer/notification tick was healthy. No test emails or plan changes. See the production release section of the capacity rehearsal report.


Reconciled-cycle follow-up (isolated, not deployed): eight-arrival emails fell from 288 to 64 for one fully opted-in league and from 14,400 to 3,200 in the fifty-league overlap fixture. Source queues drained by the end of all scenarios; the overlap email backlog remains 2,930 under the unchanged 270/day allowance. Scoring, meaningful corrections, settings and separate email delivery are preserved. Migration 0016 and the runner/Worker require a coordinated release. See race-capacity-rehearsal.md for measurements and limits.


Cycle release completed November 7: migration 0016, Worker ddd2e52a-0ba6-47d5-ba2a-e329d2dc3528 and runner d271d35 are live. Verification run 42415311685 imported all eight studies and updated all 36 histories/statistics; rankings/leagues and email counters stayed unchanged. Automatic notification/email timers passed; no live race targets existed. Earlier pending-release notes are superseded. See race-capacity-rehearsal.md for the full release record.


## Monthly archive sharding - November 7, 2026

History routing now supports up to eight archive bindings plus main D1. Initial rollout adds `HISTORY_ARCHIVE_2`; `HISTORY_SHARD_COUNT` makes a missing declared binding fail instead of quietly returning incomplete trails. Migration 0017 adds the indexed `(bird_id, month)` placement directory. Existing archive chunks stay in their current database. For a new monthly chunk, the importer chooses the configured archive with the smallest measured physical size below 400 MB, then persists its assignment under the existing history lease before uploading. Multipart pieces, retries and later rewrites use that same location. Writes stop at 450 MB or unavailable size telemetry, preserving existing data and leaving space below the free 500 MB hard limit. Additional shards do not raise account-wide query or write allowances.

Public window/full-history readers, scouting summaries, ranking rebuilds, migration-summary updates and lifecycle cleanup recognize all configured stores. The main-database legacy copy is still pruned only after the runner verifies decoded readback. Protected current-season/recent records, arrival evidence and five-minute old-history sampling policies are unchanged. Existing chunks are not bulk moved, rewritten or deleted during rollout. Growing an already-assigned month still requires headroom in its assigned shard; automatic relocation of existing months is deliberately not implemented. Per-shard capacity warnings remain at 350/400/450 MB. Add verified empty shards before new-month allocation runs out of headroom.

Sharded writes accept one monthly chunk per request to bound free Worker query work. The production history runner already uses single-month writes. Isolated tests exercised two and eight archive bindings, with at most 34 SQL calls in a history request. Tests verify exact full-resolution round trips, stable placement after size changes/restarts, interrupted multipart uploads and failed manifest commits, legacy readback before pruning, correct profiles/rankings, missing-binding and exhausted-capacity failures, restoration of all stores, and lifecycle cleanup with preserved past-league records. The full 175-unit-test/integration suite and build passed. Tests use only synthetic data and block external requests.

Rollout requires archive schema initialization, main migration 0017, then Worker deployment with all bindings. Do not roll back to a single-archive reader after data reaches another shard; retain the multi-shard reader or restore a complete matching recovery set. Free D1 currently permits 10 databases/account, 500 MB/database and 5 GB total; initial app inventory is main plus two archives. No paid plan or R2 is required. See https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/d1/platform/pricing/ for account limits.
