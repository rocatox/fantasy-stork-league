# Fantasy Stork League

Public installable React web app, private invite-only leagues, and real white-stork migration data. Runs in the owner's Cloudflare account, with D1 persistence and Clerk Google/email authentication. No OpenAI hosting or runtime is required. Codex is an optional development tool.

## Development

Use Node 22.13 or newer. Run `npm ci`, `npm test`, and `npm run dev`. Build with `npm run build`. Authenticate deployments with `npx wrangler login`. Apply schema with `npm run db:migrate`, then publish with `npm run deploy`. Use your own Cloudflare account and database identifiers in `wrangler.jsonc` when forking.

Configure `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `MOVEBANK_API_TOKEN`, and a unique `SYNC_SECRET` with `wrangler secret put KEY`. Never commit secrets or private database exports. `APP_ORIGIN` must match the deployed origin. Clerk must allow Google and verified email authentication. Production Clerk setup requires the provider's production-domain configuration; development keys are for staging validation.

## Scheduling

Migration staging starts with `SYNC_ENABLED=false` and no Cron Triggers. After verification, configure `15 * * * *` and enable syncing. The scheduled handler enforces six-hour Eastern slots outside January 16–June 30 and hourly slots during that period, including DST. Daily metadata refresh discovers birds only from the eight approved studies. Requests stream observations; transient failures retain existing data. The endpoint is independently protected by `SYNC_SECRET`; the cron handler invokes the same importer internally.

## Rules

Only valid observations no more than 30 days old qualify. Birds must be outside Germany and more than 450 statute miles from its boundary, with a valid deployment, no recorded death, and no duplicate/review hold. Eight players maximum; at most six birds per player. Snake drafting freezes roster size at start. Unfinished lobbies/drafts disband at the end of January 15 Eastern, revoke invites, and retain history. Completed drafts remain. Drafted stale birds remain owned; no replacements after the deadline.

## Migration status

The original deployment remains running until the new app, authentication, data import, and scheduled updates pass verification. The new database is separate. Existing private leagues must be exported securely and their old member IDs mapped through verified account ownership before cutover; no league data belongs in this repository. Preserve a rollback export and coordinate the final write handoff to avoid losing league changes.

Scoring/arrival reconciliation is not yet implemented. The Natural Earth boundary uses spherical distance and holds birds within five miles of the threshold for review; authoritative boundary refinement remains before competitive launch. Existing study attribution/licenses are retained in the app. DTEK is excluded.
