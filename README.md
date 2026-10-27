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
## Rules

Only valid observations no more than 30 days old qualify. Birds must be outside Germany and more than 450 statute miles from its boundary, with a valid deployment, no recorded death, and no duplicate/review hold. Eight players maximum; at most six birds per player. Snake drafting freezes roster size at start. Unfinished lobbies/drafts disband at the end of January 15 Eastern, revoke invites, and retain history. Completed drafts remain. Drafted stale birds remain owned; no replacements after the deadline.

## Production domain

The Worker is configured for https://storkleague.fans, with the workers.dev endpoint retained during migration. Clerk currently accepts both explicitly configured app origins while development-mode sign-in remains in use. After production Clerk verification, remove LEGACY_APP_ORIGIN. The custom domain passed public HTTPS, database, and eight-source readback checks on October 27, 2026. The sync workflow now uses https://storkleague.fans.

## Migration status

The original deployment remains running until the new app, authentication, data import, and scheduled updates pass verification. The new database is separate. The original Sites leagues table was verified empty on October 26, 2026 Eastern, so no existing member IDs needed mapping. Recheck before final cutover if users create leagues on the original app. Never commit private league data. Google and email sign-in were verified by the owner using the existing Clerk development application; production Clerk/domain configuration remains a launch requirement.

Scoring/arrival reconciliation is not yet implemented. The Natural Earth boundary uses spherical distance and holds birds within five miles of the threshold for review; authoritative boundary refinement remains before competitive launch. Existing study attribution/licenses are retained in the app. DTEK is excluded.




Player usernames come from Clerk, never first/last names. Enable usernames in the production Clerk instance, set maximum length 15, and allow changes. League responses resolve current usernames by immutable Clerk user ID; pending/overlength usernames are shown as pending, not truncated. Creating or joining requires a valid username.
