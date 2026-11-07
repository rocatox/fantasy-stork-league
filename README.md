# Fantasy Stork League

Public installable React web app, private invite-only leagues, and real white-stork migration data. Runs in the owner's Cloudflare account, with D1 persistence and Clerk Google/email authentication. No OpenAI hosting or runtime is required. Codex is an optional development tool.

Documentation reviewed against implementation on November 7, 2026. The player-facing guide is [How to play](https://storkleague.fans/?view=rules), maintained in `app/HowToPlay.tsx`. Dated test reports describe verification at that time, not continuous production monitoring.

## Development

Use Node 22.13 or newer. Run `npm ci`, `npm test`, and `npm run dev`. Build with `npm run build`. Authenticate deployments with `npx wrangler login`. Apply schema with `npm run db:migrate`, then publish with `npm run deploy`. Use your own Cloudflare account and database identifiers in `wrangler.jsonc` when forking.

Configure `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and a unique `SYNC_SECRET` with `wrangler secret put KEY`. Configure `GITHUB_SYNC_TOKEN` as a Worker secret for the Cloudflare-to-GitHub timer. Configure `MOVEBANK_API_TOKEN` and the same `SYNC_SECRET` as encrypted GitHub repository Actions secrets. Never commit secrets or private database exports. `APP_ORIGIN` must match the deployed origin. Clerk must allow Google and verified email authentication. Production Clerk setup requires the provider's production-domain configuration; development keys are for staging validation.

## Scheduling

GitHub Actions performs Movebank downloads, streamed parsing, detailed geometry, history compression and statistics. Cloudflare validates and persists authenticated writes in D1, serves the app, and triggers background jobs. The Movebank credential stays in GitHub Actions, never in the browser.

The Cloudflare cron in `wrangler.jsonc` runs at minutes **11, 26, 41 and 56 of every hour**. `lib/sync-timer.mjs` checks source slots and workflow state, then dispatches `sync.yml` when due. The workflow title identifies these as **Sync approved studies (Cloudflare timer)**, although GitHub's event type is `workflow_dispatch`. GitHub's own `17,47 * * * *` schedule remains a fallback, gated by repository variable `SYNC_SCHEDULE_ENABLED`.

Imports use hourly Eastern slots during January 16–June 30 and six-hour slots otherwise. The first successful daily slot refreshes metadata and discovers birds within the eight approved studies. Timer checks are not import intervals: completed studies can legitimately be policy-skipped. A dispatch lease, active-workflow check, 30-minute cooldown, three-attempts-per-slot ceiling, workflow concurrency and writer leases limit duplicates. Failed/invalid imports preserve the last committed data.

`SYNC_ENABLED` gates the Cloudflare dispatcher; it does not disable GitHub's fallback or manual dispatch. The same cron separately pumps durable notifications, time-based reminders/settlement and email delivery. See [operations and configuration](docs/operations.md) for controls, health checks and failure handling. Scheduling is best effort; eligibility and deadlines are enforced server-side independently of scheduler timing.

The workflow has read-only repository permissions and receives `MOVEBANK_API_TOKEN` and `SYNC_SECRET`, not Clerk or Cloudflare account credentials. For an intentional local import, set these secrets only in process memory, run `node scripts/build-runner.mjs`, then the appropriate `.runner` script. These are production-writing commands when pointed at production. `FORCE_RECONCILE=true` is for explicit repair/verification, not routine runs. Keep generated output, backups and raw GPS diagnostics out of Git and workflow artifacts.

## Persistent migration archive

History uses lossless column-oriented gzip in D1 BLOBs, with backward-compatible reads of older base64 row archives. JSON transfers use base64, but the database stores binary bytes. Every replacement is read back and compared field-for-field before the superseded legacy month is removed. No R2 account or paid storage is used.

Retention: full source resolution is retained for the most recent 30 days and for January 16–June 30 seasons until at least 30 days after season end. Any unsettled completed-draft league extends that season's protection. Older history retains the first valid observation in each UTC five-minute bucket per tag, plus exact arrival/correction event IDs. Race results and the permanent race audit are never sampled; scoring still reconciles full-resolution Movebank exports. Late corrections to sampled months trigger a full source-month refresh before resampling. Reopened seasons restore sampled months from the authorized source; failures preserve the existing archive and do not advance the cursor. Older sampled trails cannot provide exact travel distances or reproduce every short visit.

New birds still import all available authorized history, then apply this retention policy. Normal runs compact newly expired windows even without new GPS records. `compactAfter` schedules that work. The history runner continues to run in GitHub Actions; CPU-heavy compression remains outside Workers. Map previews remain bounded, separate from retained records. Before the initial migration, both history stores were exported and locally restore-tested in `../history-recovery-2026-10-27/`.

## League and roster rules

- Private leagues use stable six-digit invite codes, including leading zeroes. Each manager may belong to six active leagues; a league supports 2–8 managers. Creating/joining is closed during racing. A non-host may leave only during invitations; the host may disband through the end of drafting. Disbanded/abandoned leagues are hidden from history.
- New picks require a valid observation no more than 30 days old, a current deployment, no recorded death/review hold, and a location outside Germany strictly more than 450 statute miles from the boundary. Fresh nearby birds remain explorable research birds. Eligibility and identity are checked when saving.
- Draft order is randomized and reverses each round. Initial team size is `min(6, floor(eligible birds / managers))`, locked at draft start. There is no fixed 30-bird pool cap. All picks must finish before January 16 at 00:00 America/New_York; unfinished lobbies/drafts disband automatically.
- Trading starts when the entire draft finishes. Each proposal exchanges at least one bird on each side; unequal trades may produce rosters above six. At most three outgoing proposals may be pending. Acceptance requires the other manager; impossible competing proposals are cancelled.
- During trading, any manager may swap one owned bird for an eligible unclaimed pool bird. Swaps and replacements have no turn order, preserve roster size and close at the same preseason deadline. Replacements are unavailable during drafting or racing.
- Moving closer to Germany never invalidates an owned pick. Preseason inactivity/death can offer a replacement, but an old flag never forces zero points. Recovery clears the alert, including recovery inside 450 miles. Every retained roster bird stays in race reconciliation; a supported race arrival scores normally. No qualifying arrival means zero points, and a later tracking loss does not erase an earlier valid arrival.

See `lib/rules.mjs`, `lib/trades.mjs`, `lib/replacements.ts`, `lib/race.mjs` and the authenticated league handler for enforcement. The [eight-manager rehearsal](docs/full-season-rehearsal.md) exercises these rules together.

## Production domain and migration

The production app is https://storkleague.fans, with production Clerk Google/email sign-in and member-only league access verified. Migration completed October 27, 2026. The original Sites address now redirects to production; its API returns HTTP 410. Both old ChatGPT sync tasks were deleted. Original source, bird snapshot and recovery instructions were saved locally, and the original database was retained. No original leagues needed migration. Cloudflare now triggers GitHub Actions imports, with GitHub scheduling as fallback; both are independent of the retired app.

## Race engine

Completed drafts race from January 16 00:00 Eastern through June 30 23:59:59.999 Eastern. The race importer runs after normal study syncing and before history backfills. It checks full-resolution, full-season GPS exports for drafted bird/season pairs, deduplicated across leagues, at the same hourly/six-hour cadence. This is intentionally independent of recent-location snapshots and sampled map trails. Future seasons are queued only when their race window opens. Internal individual IDs are captured at drafting and retained on first reconciliation; unexpected identity changes require review.

An arrival is the first quality-screened, corroborated source observation strictly inside the pinned German geometry during a matching tag deployment, before any recorded mortality. Points exactly on the polygon boundary await an interior observation; no crossing time is interpolated between outside fixes. The source observation timestamp determines ordering, even for delayed uploads. A league with M drafted birds gives M, M-1, … points; exact-time ties share the average of occupied places. Nonfinishers receive zero. Team points are summed, and equal team totals share rank.

Every reconciliation replaces the prior arrival from a complete season export. Corrected, hidden or withdrawn observations can retract an arrival or promote the next observation. Failed requests and unexpectedly empty replacements preserve previous committed results for review. Such failures remain visible as GitHub job failures and eventually stale standings; an entirely emptied source export requires review. Audit rows record arrival changes and boundary version. Scores are derived from those shared bird results and each league's roster after preseason trades and swaps. Private standings are returned only with authenticated member league responses.

The 72-hour provisional period starts when an arrival/result changes in our system, not at a backdated observation time. New evidence reopens that period even after a season has settled. Season completion requires a successful full-window check for every drafted bird, the June 30 cutoff, and the review interval. Missing data remains explicitly pending; zero recorded arrivals is not proof a bird never visited Germany.

## German boundary

Race checks use BKG VG25 national geometry, downloaded October 27, 2026, selected in CRS84 with `lkz=DE` and `gf=9`, without simplification. This includes 144 polygons (mainland, islands, exclaves and joint German-Luxembourg territory), while excluding unstructured marine and technical Lake Constance partitions. Metadata, license, source and the geometry SHA-256 are in `data/boundary-source.json`. The national map remains a simplified Natural Earth overview; scoring does not use that display geometry.

Eligibility distances use GeographicLib WGS84 geodesic inverses, minimized along the original GeoJSON boundary segments. A conservative spherical lower bound prunes distant candidates; it is not the final distance. Distance must exceed 450 statute miles; observations within 50 metres of that cutoff remain on a precision-review hold. Geography is recomputed when the pinned version changes, even if the bird has not moved. New picks wait for the current boundary check. Source/GPS resolution still limits real-world accuracy; this is a reproducible game boundary, not a cadastral survey. Do not change the pinned boundary during a season without an explicit rules review and reconciliation.

Attribution: © [BKG](https://www.bkg.bund.de) (2026), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [data sources](https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf). Selection/combination is the modification. Official product documentation: https://sgx.geodatenzentrum.de/web_public/gdz/dokumentation/deu/vg25.pdf.

## Verification and deployment

`npm test` includes a simulated season using the actual pinned geometry, plus isolated SQLite endpoint tests for authenticated writes, exclusive leases, replay protection, corrections, audit persistence and private standings. `node scripts/simulate-season.mjs` writes an interactive synthetic-season demonstration to the sibling `race-simulation/` folder; it never creates production leagues or scores. Tests cover tied birds and teams, delayed observations, retractions, June 30 boundary times, nonfinishers, invalid fixes, deployment identity and late reopening of results.

For a new environment, apply all pending migrations to both D1 databases, configure secrets, then build/deploy. Do not repeat historical one-off imports as routine deployment steps. The current setup uses Workers/D1 and GitHub Actions without R2; capacity is bounded by provider quotas. DTEK remains excluded. See [operations](docs/operations.md).

`npm test` also runs the [eight-manager full-season rehearsal](docs/full-season-rehearsal.md), with isolated SQLite and intercepted email HTTP. It does not create real leagues or send real emails.

Player usernames come from Clerk, never first/last names. Enable usernames in the production Clerk instance, set maximum length 15, and allow changes. League responses resolve current usernames by immutable Clerk user ID; pending/overlength usernames are shown as pending, not truncated. Creating or joining requires a valid username.

## Research storks
Recent white storks within 450 miles of Germany, including Germany itself, are explorable research birds from the approved studies. They are grey on the public map and hidden by the Eligible filter. Draft eligibility remains unchanged. Source mortality and deployment metadata affect lifecycle and draft eligibility. Research birds automatically queue the same full-history import and retention process; previously archived birds continue updating even after their fixes become stale. Team maps retain team colors for race tracking.



### Live bird lifecycle
Eligibility, map color, and draft access are recalculated from the latest valid observation: more than 450 miles from Germany and at most 30 days old, with all existing identity/deployment checks. Recent nearby birds remain research-only.

Movebank mortality metadata marks a bird deceased; missing telemetry alone never does. Observations older than 30 days mark a bird inactive. Both remain visible, grey and undraftable from January 16 00:00 Eastern through July 30 23:59:59 Eastern (the June 30 season plus 30 days). Outside this protected window they are hidden immediately and the next scheduled history queue deletes their live roster, all archived trails/parts, history state, and cached source metadata. Cleanup waits for existing history leases to finish or expire, retries interrupted deletion, and preserves identity snapshots and scoring evidence in leagues that drafted them. New picks always save an identity snapshot. No static seed fallback can resurrect removed birds. An inactive bird can return through daily discovery when fresh observations resume, with a new full-history backfill. Existing offline recovery backups and Movebank's original records are not altered by live database cleanup.

### Map and migration replay

Both maps use spherical Mercator. Mouse/touch dragging pans; wheel/trackpad and touch pinch zoom, with keyboard arrow and +/− controls. Follow bird sits beside Fit route. Camera transitions and playback respect reduced-motion preferences. Manual gestures can interrupt following. Germany has a low-opacity gold fill without an outline; display geometry is not the scoring boundary.

The main migration map always offers rolling 30-day background trails. Selecting a bird hides those trails and opens its full available replay at the top of its profile. The league map shows at least 30 days, expanding to season-to-date while racing. Its persistent timeline scrubs all displayed teams together unless a bird is selected. Closing an undrafted bird's profile restores the prior team filter. Replay has play/pause, speed, stepping and a scrubber; there is no minimize, date-picker or find-stork control.

The history endpoint's `timeline=1` mode serves bounded display previews rather than raw archive chunks. Playback interpolates for display only, keeps tracking gaps distinct and omits gap/antimeridian connections. Overlapping translucent trail legs remain visible. Background team/recent trails fade from current to oldest observations; full-history replay uses 70% opacity. None of this interpolation or simplification supplies race evidence.

Recent-trail loading lives above page navigation in `StorkApp`, so it continues across app tabs and retains prepared trails on return. It is in-memory caching, not permanent offline storage or a guarantee of background execution when the browser suspends the app. See the loading audit below for priorities and cache limits.

## Historical scouting statistics
Profiles count January–June seasons whose first valid, non-boundary retained GPS fix is outside Germany as recorded attempts. A later quality-screened inside fix supported by surrounding observations confirms an arrival. Seasons first seen inside Germany are excluded; missing arrivals are unconfirmed rather than proven failures. Dates are UTC first corroborated inside observations, not interpolated border crossing instants. Historical five-minute archive sampling and missing source data limit precision. A typical date is shown with even one confirmed arrival. It uses the lower median of on-time and late arrival month/day dates in a common leap year. A supported arrival later in the same calendar year is labelled “Arrived late on [date]”; it affects typical date and spread, but not spring success count or race points. Arrival spread is the median absolute deviation from that typical date, needs two arrivals, and is not the full earliest-to-latest range. Supplied ages use one decimal place; otherwise the profile shows an “At least” lower bound from available minimum age/tracking history.

The Node history runner maintains compact monthly migration summaries using the pinned detailed German boundary. `migration-stats-runner` backfills summaries directly from retained archive records under exclusive history leases, updates only summary metadata, and resumes missing months on later runs. The public endpoint aggregates these small summaries without decompressing histories or doing large geometry scans in Workers Free. Normal scheduled history writes recalculate affected summaries; roster cleanup still removes archives and their summaries together.

## Replacement notifications

During trading, an affected manager can receive a replacement opportunity naming the bird and league and the January 15 deadline. Repeated checks deduplicate the event per pick. Recovery clears the replacement flag; prior prompts become non-actionable rather than imposing a scoring penalty. A recovered bird can score with a qualifying arrival. The notification, roster alert and How to play wording reflect this rule.

Notification delivery is implemented, not a backlog item. See the in-app section below and [email notifications](docs/email-notifications.md).

## Stork portraits

The 64 generated portraits are bundled as 256px WebP assets in `public/stork-portraits` (about 689 KiB total). Immutable IDs 1–64 are grouped into eight background-color families, eight portraits each. Original PNGs and generation prompts are preserved in the sibling `../stork-portraits-v1` output folder.

`bird_portraits` stores a unique portrait per live bird. The public roster refresh reconciles assignments atomically against current database rows: existing assignments remain stable; new birds receive randomly ordered available portraits, prioritizing the least-used color families. Eligible and research-only birds use the same pool. Search, map filtering, distance changes, and sorting never release an assignment. Deceased/inactive birds retain theirs during season protection and the 30-day grace period; once excluded from the live roster, their slots can be reused. If all 64 slots are occupied, extra birds display a neutral placeholder until a slot is freed or the catalog and database constraint are expanded. No occupied image is duplicated.

Validation: `node --test tests/bird-portraits.test.mjs` covers uniqueness, color balance, stable refreshes, discovery, exhaustion, release/reuse, and season retention.

### Visual trail quality checks
Every loaded migration timeline (including new history and newly discovered birds) passes through `trackPoints`; drawing and playback share the same implausible-leg guard. Isolated out-and-back fixes are excluded only when both adjacent legs exceed 150 km/h over more than 5 km and the direct neighbor-to-neighbor leg passes. Other suspect jumps are left as observations but are not connected or interpolated. Visual screening preserves source data; the version-4 arrival checks described below additionally screen statistics and scoring. Timelines use monthly previews, so it cannot certify every raw fix. An already open replay keeps its loaded data until reopened/reloaded; the timeline cache expires after ten minutes.

Run `node scripts/audit-trails.mjs` to audit every current public roster timeline, including research-only birds. The local report defaults to `.wrangler/trail-audit.json`; optional arguments override the origin and report path. The audit fails on retrieval failures or suspect segments that are still drawn/interpolated. Source observations and race evidence remain unchanged.


### GPS quality and surrounding-observation arrivals (version 4)
Map trails, migration statistics and race imports retain the existing isolated-spike, implausible-speed and erroneous-burst checks. An arrival always requires an observed fix strictly inside the precise German boundary; a drawn/interpolated crossing never counts.

A screened inside fix is supported either by the next consistent, same-tag inside observation (without the old five-minute/48-hour restriction), or by a plausible brief crossing. A brief crossing needs healthy same-tag outside observations before and after, each within six hours, a path no longer than twice their direct distance plus 1 km, and an inside fix at least 200 m from the boundary. The buffer is a conservative heuristic against border jitter, not a claim about every tag's accuracy. Unsupported fixes remain unconfirmed.

Historical statistics screen the calendar year together, with adjacent December/January context; January–June fixes establish attempts, while later months can confirm late arrivals. Sparse observations can therefore support the original date across month boundaries. Race imports include up to 31 days of context on either side of the season; only the inside observation within the season sets the arrival time. The server validates the evidence shape, tag IDs, timing, geometry and support type. All evidence event IDs—including the preceding fix for brief crossings—are protected from archive sampling.

History changes invalidate affected seasonal summaries and adjacent-year context where needed. Scheduled statistics rebuilding and race reconciliation apply the same rules automatically. Earlier-version results remain pending until recalculated. Raw archives remain intact. No coordinate heuristic guarantees that every erroneous source fix can be identified.

### Private scouting lists

Account-owned lists use `/api/lists` and the `0006_scout_lists.sql` migration in the main D1 database. Every request uses Clerk session authentication; owner IDs come only from the session. Each account may have five lists, unique names (up to 15 characters) and unique icons from the shared 30-icon menu. Birds may belong to multiple lists; deleting a list cascades only its memberships. Stars remain separate browser-local favorites. Lists refresh on return to the app and every minute while visible; edits update immediately. Run `node tests/scout-lists.mjs` for API privacy, validation, capacity and persistence checks.


### Map loading and interaction audit (November 2026)

Both maps share `MigrationMap`. Network reads, JSON parsing, GPS screening and display simplification run in separate background/selected-history workers. The migration overview requests a rolling 30-day window; the selected bird loads its complete timeline. League replay keeps its existing season/30-day window and exact replay observations. Canvas draws screen-space geometry at a scale-dependent level of detail; simplification never changes race evidence or connects tracking gaps.

The audit removed repeated marker projection, bounds sorting and replay-position calculations on camera-only frames; combined playback and follow into one animation callback; and coalesced pointer movement and wheel events to animation frames. Wheel/trackpad zoom is cursor-anchored, eases toward its target, respects reduced motion, and stops when a new selection, fit or pointer gesture takes over. Manual zoom disables following. Wheel interception applies only over the map, leaving page scrolling and timeline controls alone.

Recent trails use three concurrent requests within cohorts of twelve birds. Each cohort receives coarse previews followed by detail while its responses still fit within the 64-entry, ten-minute worker cache. This avoids a large all-preview pass evicting responses before refinement. Completed results are batched and wait for the interaction-priority gate before React commits. Selected history has an independent worker and an eight-entry cache. The finest geometry is transferred once and shared with its first LOD; payload chunks remain bounded at 1,000 entries. Abort signals now cancel abandoned worker processing/delivery. An already-started shared network fetch may finish and populate the cache.

Validation covers cursor anchoring and zoom limits, wheel units, geometry transfer, caching, interaction priority, gap-safe replay and league windows. Local browser checks used 120 synthetic birds with 20,000 source observations each, plus production desktop and 390-pixel layouts. Synthetic routes are simpler than some real histories, and automation frame intervals are not a reliable device FPS benchmark; this is not a guarantee of stutter-free rendering on every device.

Remaining scaling costs: initial application/geography bundle parsing, exact selected-history payload size, and drawing visible geometry still grow with data. Background delivery intentionally waits during active playback/gestures. For substantially larger rosters, profile realistic routes before adding viewport-specific detail loading or an OffscreenCanvas renderer. Keep the current screen-space canvas alignment and independent translucent legs when changing renderers; prior transformed overlays introduced jitter and obscured overlaps.


### Trade-phase pool swaps

After drafting is complete and before the January 16 midnight Eastern cutoff, a manager can exchange any owned pick for one eligible bird not already claimed in that league. There is no turn order or swap quota; one-for-one swaps preserve roster size, including rosters larger than six after trades. Eligible released birds return to that league's available pool. Dead/inactive picks use the same swap route during trading only; replacements cannot be fulfilled during drafting.

`POST /api/leagues` with `action: "swap"`, `originalBirdId` and `birdId` shares the pick/replacement eligibility, boundary and individual-ID checks. The revision/deadline-guarded write atomically replaces the pick, records both snapshots in `league.swaps`, and cancels pending trades made impossible by the roster change. Competing claims return a conflict rather than assigning a bird twice. `node tests/league-flow.mjs` exercises these rules, including ownership, released birds, rosters above six, concurrent claims and a write crossing the deadline.

## In-app notifications

D1 triggers atomically append a source snapshot to `notification_outbox` whenever a league or race result changes. This captures joins, draft turns/stages, proposals and outcomes, replacements, and validated race changes even when no browser is open. A failed source transaction cannot create an alert. The queue is FIFO with a delivery lease, per-account source cursors and optimistic revisions; interrupted fan-out resumes without duplicate alerts. Source snapshots contain existing race evidence transiently inside D1; delivered inbox records contain no raw GPS fixes, and processed queue rows are deleted.

League/sync/race requests kick a bounded background delivery pump. The existing 15-minute Cloudflare timer also checks inactive picks, expiry/deadline reminders and time-based race settlement, then retries queued delivery. Each delivery request handles one league snapshot / at most eight managers, with a tested budget below Free D1’s 50-query limit. This in-app pipeline adds no paid queue or R2. Email is now implemented separately through Resend and shares the existing timer; push remains deferred. The main health endpoint reports notification processor status and queue depth. Queue entries are durable until delivered; a prolonged processing failure appears as `retry-needed` and requires investigation if it persists.

The inbox polls every 60 seconds while visible, on focus and after league actions, but polling is no longer responsible for event creation. Account settings/read state sync across devices. Each notification links to its league if still accessible. Retained unread prompts that are no longer actionable are labelled as earlier updates. Reading a notification removes it from the default unread view; Show read is offered when that view is empty. Initial baseline snapshots avoid importing historical outcomes, while current actionable prompts are included. Existing on-demand history cannot reconstruct transitions that disappeared before this feature went live.

Inbox retention remains 90 days / 200 recorded events per account, with the newest 10 displayed initially and Load older revealing another 10 at a time until all retained, enabled notifications are visible. The bounded account snapshot is fetched together, so expanding the inbox adds no database requests. The header unread indicator and Mark all read include retained older notifications; the popup does not repeat a numeric unread count. Clicking outside dismisses it. Category choices suppress delivery, including new-manager join alerts for the host under Draft & league stages. The UI saves checkbox changes optimistically in sequence without disabling or flashing the other controls; failures roll back the failed change. The timer stays on the Workers Free plan. Free quotas remain account-wide; this design bounds per-invocation work rather than promising unlimited scale.

Race notification controls are split into My race updates (own birds and final league results) and League race updates (every manager’s birds). Own-bird events are stored once and enabled by either toggle. Existing accounts inherit their previous race choice for both controls; no new historical arrival flood is generated.

Migration-start alerts use a conservative sustained-displacement detector in the existing race import. See [detection rules, historical replay and limitations](docs/migration-start-notifications.md). Final league results follow My race updates.

The [simulated notification season](docs/notification-season-simulation.md) exercises migration imports through offline delivery and inbox retrieval for all four race-toggle combinations. It runs as part of `npm test` without production writes.

## Documentation index

- [Operations, configuration and safe verification](docs/operations.md)
- [Email notifications and activation record](docs/email-notifications.md)
- [Private bug reports and owner email](docs/bug-reports.md)
- [Migration-start detector v2](docs/migration-start-notifications.md) and [dated investigation](docs/migration-start-audit-2026-11-06.md)
- [Isolated notification season](docs/notification-season-simulation.md)
- [Eight-manager full-season rehearsal](docs/full-season-rehearsal.md)

The main feature set is implemented. Remaining proposed work includes capacity/free-plan measurement, operational recovery review, additional approved-study access and a broader desktop accessibility/resilience audit. Mobile installation testing is secondary; push and importing Animal Tracker photos are deferred. These are priorities, not claims of completed verification.

### Scout profile loading

Scout storks uses a shared in-memory metadata cache (up to 128 completed entries, ten-minute freshness, invalidated by the sync revision). Visible and nearby cards load with at most three concurrent metadata requests. Complete cards replace reserved placeholders; cached statistics remain visible during refresh and errors offer a per-card retry. Returning between app tabs reuses this cache. Background ranking updates preserve the displayed order; changing search, filters or sorting establishes a new order. Previous-arrival rows are rendered when expanded. This cache contains public profile metadata, not GPS archives or private scouting lists.
