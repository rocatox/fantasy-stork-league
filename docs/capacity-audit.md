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
