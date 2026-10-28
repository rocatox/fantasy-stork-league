# Fantasy Stork League

Public installable React web app, private invite-only leagues, and real white-stork migration data. Runs in the owner's Cloudflare account, with D1 persistence and Clerk Google/email authentication. No OpenAI hosting or runtime is required. Codex is an optional development tool.

## Development

Use Node 22.13 or newer. Run `npm ci`, `npm test`, and `npm run dev`. Build with `npm run build`. Authenticate deployments with `npx wrangler login`. Apply schema with `npm run db:migrate`, then publish with `npm run deploy`. Use your own Cloudflare account and database identifiers in `wrangler.jsonc` when forking.

Configure `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and a unique `SYNC_SECRET` with `wrangler secret put KEY`. Configure `MOVEBANK_API_TOKEN` and the same `SYNC_SECRET` as encrypted GitHub repository Actions secrets. Never commit secrets or private database exports. `APP_ORIGIN` must match the deployed origin. Clerk must allow Google and verified email authentication. Production Clerk setup requires the provider's production-domain configuration; development keys are for staging validation.

## Scheduling

GitHub Actions performs the CPU-intensive Movebank downloads, streamed CSV parsing, geometry calculations and eligibility reconciliation. Cloudflare only accepts authenticated, validated study snapshots through `/api/sync` and atomically commits birds, metadata and audit state. A lease prevents overlapping writers. Failed downloads or invalid snapshots preserve the previous committed study. The Movebank credential is an encrypted GitHub Actions secret, never a browser credential.

The workflow checks at minutes 17 and 47 each hour, providing a second scheduling opportunity without repeating imports for a completed slot. The importer enforces one successful run per six-hour Eastern slot outside January 16–June 30, and hourly slots during that period. The first successful run of each Eastern day refreshes metadata and performs full discovery within the eight approved studies. `SYNC_SCHEDULE_ENABLED` is the GitHub repository variable that enables scheduled jobs; manual dispatch remains available for verification. `SYNC_ENABLED` in Cloudflare controls the displayed activation status. There are no Cloudflare Cron Triggers.

Standard GitHub-hosted runners are free while this repository is public. Scheduled runs may be delayed, and GitHub disables scheduled workflows after 60 days without repository activity. Monitor the app's last-success timestamps and GitHub Actions failures; re-enable the workflow if GitHub disables it. These schedules are best effort, not precise-time guarantees. Draft eligibility uses observation timestamps and draft deadlines are enforced server-side independently of sync timing. Idle unfinished leagues are persisted as disbanded on the next sync/API access.

The workflow only receives `MOVEBANK_API_TOKEN` and `SYNC_SECRET`; it does not receive Cloudflare account credentials or Clerk secrets. It uses read-only repository permissions and serial concurrency. To reproduce a run locally: set these two environment variables in process memory, run `node scripts/build-runner.mjs`, then `node .runner/sync.mjs`. Generated runner output is ignored by Git. `FORCE_RECONCILE=true` is for explicit repair/verification, not routine runs.
## Persistent migration archive

History uses lossless column-oriented gzip in D1 BLOBs, with backward-compatible reads of older base64 row archives. JSON transfers use base64, but the database stores binary bytes. Every replacement is read back and compared field-for-field before the superseded legacy month is removed. No R2 account or paid storage is used.

Retention: full source resolution is retained for the most recent 30 days and for January 16–June 30 seasons until at least 30 days after season end. Any unsettled completed-draft league extends that season's protection. Older history retains the first valid observation in each UTC five-minute bucket per tag, plus exact arrival/correction event IDs. Race results and the permanent race audit are never sampled; scoring still reconciles full-resolution Movebank exports. Late corrections to sampled months trigger a full source-month refresh before resampling. Reopened seasons restore sampled months from the authorized source; failures preserve the existing archive and do not advance the cursor. Older sampled trails cannot provide exact travel distances or reproduce every short visit.

New birds still import all available authorized history, then apply this retention policy. Normal runs compact newly expired windows even without new GPS records. `compactAfter` schedules that work. The history runner continues to run in GitHub Actions; CPU-heavy compression remains outside Workers. Map previews remain bounded, separate from retained records. Before the initial migration, both history stores were exported and locally restore-tested in `../history-recovery-2026-10-27/`.

## Rules

Newly eligible birds import all available authorized history and apply the retention policy above. Backfills resume after failures; cursors advance only after verified writes. Source attribution, exact retained timestamps and observation IDs remain attached to the archive. Historical sampling never changes draft eligibility or race scoring.

Only valid observations no more than 30 days old qualify. Birds must be outside Germany and more than 450 statute miles from its boundary, with a valid deployment, no recorded death, and no duplicate/review hold. Eight players maximum; at most six birds per player. Snake drafting freezes roster size at start. Unfinished lobbies/drafts disband at the end of January 15 Eastern, revoke invites, and retain history. Completed drafts remain. Drafted stale birds remain owned; no replacements after the deadline.

## Production domain and migration

The production app is https://storkleague.fans, with production Clerk Google/email sign-in and member-only league access verified. Migration completed October 27, 2026. The original Sites address now redirects to production; its API returns HTTP 410. Both old ChatGPT sync tasks were deleted. Original source, bird snapshot and recovery instructions were saved locally, and the original database was retained. No original leagues needed migration. GitHub Actions is the independent production scheduler.

## Race engine

Completed drafts race from January 16 00:00 Eastern through June 30 23:59:59.999 Eastern. The race importer runs after normal study syncing and before history backfills. It checks full-resolution, full-season GPS exports for drafted bird/season pairs, deduplicated across leagues, at the same hourly/six-hour cadence. This is intentionally independent of recent-location snapshots and sampled map trails. Future seasons are queued only when their race window opens. Internal individual IDs are captured at drafting and retained on first reconciliation; unexpected identity changes require review.

An arrival is the first valid source observation strictly inside the pinned German geometry during a matching tag deployment, before any recorded mortality. Points exactly on the polygon boundary await an interior observation; no crossing time is interpolated between outside fixes. The source observation timestamp determines ordering, even for delayed uploads. A league with M drafted birds gives M, M-1, … points; exact-time ties share the average of occupied places. Nonfinishers receive zero. Team points are summed, and equal team totals share rank.

Every reconciliation replaces the prior arrival from a complete season export. Corrected, hidden or withdrawn observations can retract an arrival or promote the next observation. Failed requests and unexpectedly empty replacements preserve previous committed results for review. Such failures remain visible as GitHub job failures and eventually stale standings; an entirely emptied source export requires review. Audit rows record arrival changes and boundary version. Scores are derived from those shared bird results and each league's own immutable completed draft. Private standings are returned only with authenticated member league responses.

The 72-hour provisional period starts when an arrival/result changes in our system, not at a backdated observation time. New evidence reopens that period even after a season has settled. Season completion requires a successful full-window check for every drafted bird, the June 30 cutoff, and the review interval. Missing data remains explicitly pending; zero recorded arrivals is not proof a bird never visited Germany.

## German boundary

Race checks use BKG VG25 national geometry, downloaded October 27, 2026, selected in CRS84 with `lkz=DE` and `gf=9`, without simplification. This includes 144 polygons (mainland, islands, exclaves and joint German-Luxembourg territory), while excluding unstructured marine and technical Lake Constance partitions. Metadata, license, source and the geometry SHA-256 are in `data/boundary-source.json`. The national map remains a simplified Natural Earth overview; scoring does not use that display geometry.

Eligibility distances use GeographicLib WGS84 geodesic inverses, minimized along the original GeoJSON boundary segments. A conservative spherical lower bound prunes distant candidates; it is not the final distance. Distance must exceed 450 statute miles; observations within 50 metres of that cutoff remain on a precision-review hold. Geography is recomputed when the pinned version changes, even if the bird has not moved. New picks wait for the current boundary check. Source/GPS resolution still limits real-world accuracy; this is a reproducible game boundary, not a cadastral survey. Do not change the pinned boundary during a season without an explicit rules review and reconciliation.

Attribution: © [BKG](https://www.bkg.bund.de) (2026), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [data sources](https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf). Selection/combination is the modification. Official product documentation: https://sgx.geodatenzentrum.de/web_public/gdz/dokumentation/deu/vg25.pdf.

## Verification and deployment

`npm test` includes a simulated season using the actual pinned geometry, plus isolated SQLite endpoint tests for authenticated writes, exclusive leases, replay protection, corrections, audit persistence and private standings. `node scripts/simulate-season.mjs` writes an interactive synthetic-season demonstration to the sibling `race-simulation/` folder; it never creates production leagues or scores. Tests cover tied birds and teams, delayed observations, retractions, June 30 boundary times, nonfinishers, invalid fixes, deployment identity and late reopening of results.

Apply `drizzle/0004_race.sql` to DB before deploying the worker or publishing the new workflow. It only creates race results and audit tables. Deploy the worker, push the workflow, then run a manual reconciliation to refresh all eight studies against the detailed boundary. No paid hosting is introduced. DTEK remains excluded.

Player usernames come from Clerk, never first/last names. Enable usernames in the production Clerk instance, set maximum length 15, and allow changes. League responses resolve current usernames by immutable Clerk user ID; pending/overlength usernames are shown as pending, not truncated. Creating or joining requires a valid username.

## Research storks
Recent white storks within 450 miles of Germany, including Germany itself, are explorable research birds from the approved studies. They are grey on the public map and hidden by Eligible only. Draft eligibility remains unchanged. Source-reported mortality and deployment status are visible in profiles. Research birds automatically queue the same full-history import and retention process; previously archived birds continue updating even after their fixes become stale. Team maps retain team colors for race tracking.



### Live bird lifecycle
Eligibility, map color, and draft access are recalculated from the latest valid observation: more than 450 miles from Germany and at most 30 days old, with all existing identity/deployment checks. Recent nearby birds remain research-only.

Movebank mortality metadata marks a bird deceased; missing telemetry alone never does. Observations older than 30 days mark a bird inactive. Both remain visible, grey and undraftable from January 16 00:00 Eastern through July 30 23:59:59 Eastern (the June 30 season plus 30 days). Outside this protected window they are hidden immediately and the next scheduled history queue deletes their live roster, all archived trails/parts, history state, and cached source metadata. Cleanup waits for existing history leases to finish or expire, retries interrupted deletion, and preserves identity snapshots and scoring evidence in leagues that drafted them. New picks always save an identity snapshot. No static seed fallback can resurrect removed birds. An inactive bird can return through daily discovery when fresh observations resume, with a new full-history backfill. Existing offline recovery backups and Movebank's original records are not altered by live database cleanup.

### Map and migration replay
The explorer and team maps use standard spherical Mercator coordinates with one shared scale for both axes. Drag with a mouse or touch to pan, pinch to zoom on touch screens, or use the zoom/reset buttons. Keyboard users can focus the map and use arrow keys and +/−. Germany has a 16% gold fill over the land base; precise scoring still uses the existing BKG geometry.

Bird profiles open a full-history replay rather than requiring a year selection. The history endpoint's `timeline=1` mode returns the existing bounded monthly display previews across all available years, without reading raw archive chunks. A chronological time slider, previous/next observation buttons, fit-route and find-stork controls move a distinct historical marker. Visual playback interpolates in Mercator space between sampled observations up to seven days apart for display only. Longer gaps hold the last observed position and show a prominent tracking-gap notice. Connections across gaps longer than seven days or the antimeridian are omitted. Other birds remain at their latest positions and all draft/race rules continue using the authoritative data.

Replay supports play/pause at 1, 7, 30, or 90 simulated days per real second. Starting at the end restarts from the first observation; reaching the end stops automatically. Seeking and switching away from the browser tab pause playback. Animation-frame playback smoothly moves the marker while leaving the camera stationary. Manually panning or fitting the route pauses playback. The follow toggle, date picker, and bottom instructional paragraph have been removed. Both past and remaining movement lines use independently composited strokes at 70% opacity, so overlapping route sections darken. Rounded SVG joins and caps remove sharp miter artifacts without altering the GPS samples. Germany retains its 16% gold overlay without a dedicated outline.

The compact replay panel shows playback controls, the selected timestamp, the timeline, and a short tracking-gap notice when applicable; position labels, coordinates, and observation timestamps are omitted.
