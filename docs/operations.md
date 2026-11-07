# Operations reference

Reviewed against repository implementation on November 7, 2026. This is an operating reference, not a fresh production health check. Keep secrets, private database exports, report details and GPS diagnostics out of Git, chat and public workflow artifacts.

## Runtime and configuration

| Component | Responsibility | Configuration |
| --- | --- | --- |
| Cloudflare Worker | App assets/API, authentication, D1 writes, sync dispatcher, notification/email pumps | `wrangler.jsonc`, `worker/index.ts` |
| Main D1 `DB` | Leagues, birds, lists, account preferences, race evidence, notifications and reports | `drizzle/` migrations |
| History D1 `HISTORY_ARCHIVE` | Migration archive storage | `drizzle-history/` migrations; history storage also uses the main database |
| GitHub Actions | Movebank imports, race reconciliation, history and migration-statistics processing | `.github/workflows/sync.yml` |
| Clerk | Google/email sign-in, usernames and verified email lookup | Production instance and Worker keys |
| Brevo | Opt-in player email and owner bug-report email | API key and verified sending subdomain |

Worker secrets: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `SYNC_SECRET`, `GITHUB_SYNC_TOKEN`; email uses `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_ENABLED`, and bug-report delivery uses `BUG_REPORT_EMAIL`. The GitHub repository holds `MOVEBANK_API_TOKEN` and the matching `SYNC_SECRET`. Never expose secret values in output or command arguments. The sync timer token needs access to the named repository's Actions workflow dispatch/run APIs; it does not belong in the frontend.

`APP_ORIGIN` and `LEGACY_APP_ORIGIN` are configuration values, not credentials. The existing deployment and legacy redirect should remain intact during maintenance.

## Scheduler controls and interpretation

- An email-only Cloudflare cron runs every minute, processing at most six due messages and reporting status/jobs in health.emailTimer. It does not dispatch Movebank syncs or league maintenance.
- Cloudflare sync/in-app maintenance checks at minutes 11, 26, 41 and 56 each hour. `SYNC_ENABLED=true` enables its GitHub dispatcher; `GITHUB_SYNC_TOKEN` must be configured.
- GitHub's fallback checks at minutes 17 and 47. `SYNC_SCHEDULE_ENABLED=true` enables only the `schedule` event path. Manual and Cloudflare-triggered `workflow_dispatch` runs bypass that variable.
- Setting `SYNC_ENABLED=false` alone does not pause GitHub fallback imports, manual runs, or the separate notification/email pumps. Do not remove the shared cron just to pause imports: that also interrupts scheduled in-app maintenance. Email retries use their separate minute cron.
- `EMAIL_ENABLED=false` pauses sending without changing saved opt-ins. Player email can expire while paused; see the email guide. It does not stop in-app event capture.
- The dispatcher checks active runs, uses a lease and 30-minute cooldown, and allows at most three attempts per slot. A successful GitHub dispatch response only means accepted, not imported.
- Imports are hourly during racing and every six hours otherwise, in Eastern-time slots. Discovery is daily within approved studies. Slot checks may skip sources already imported by another trigger.

## Read-only health checks

1. `/api/health`: inspect `ok`, configuration booleans, `timer.lastCheckedAt`, `timer.status`, `timer.lastAcceptedAt`, notification processor status/queue depth and email processor state. These show different stages; none alone proves all imports succeeded.
2. `/api/birds`: inspect each of the eight source states and `overdueStudies`. Observation age is independent of the last successful download. A source can sync successfully without a new bird observation.
3. GitHub `sync.yml`: inspect the actual run title, status and step logs. A Cloudflare run is titled `Sync approved studies (Cloudflare timer)` and has event `workflow_dispatch`; GitHub fallback uses `schedule`. Do not label a manual run as automatic.
4. Distinguish source imports from policy skips, then check the race, history and statistics stages independently. An up-to-date incremental history check with zero new events is different from skipped or failed work.

Transient failures retain prior data and may retry. Persistent `token-required`, token-format or GitHub HTTP errors require configuration/access investigation. `retry-limit` stops additional dispatcher attempts in that slot; inspect the failed run before forcing work. A blocked queue or repeated email error requires separate attention even when bird imports are healthy.

## Development, deployment and verification

Use the Node version required by `package.json`. Routine checks are `npm test` and `npm run build`. `npm run deploy` publishes the built Worker/assets; it does not apply database migrations. `npm run db:migrate` applies main DB migrations remotely. For a new environment or schema change, also apply pending archive migrations with `wrangler d1 migrations apply HISTORY_ARCHIVE --remote`, using the configured database bindings. Review and back up relevant state before schema changes.

The sync workflow has manual `reconcile` and `statistics_only` inputs. They perform real writes against its configured origin. A forced reconciliation is not a read-only test or a normal requirement after a documentation/UI deployment. Do not manually replay accepted email batches.

`npm test` runs synthetic unit and SQLite integration tests, including `tests/full-season-rehearsal.mjs`. The rehearsal stubs authentication and external HTTP, uses no production credentials, and writes its synthetic report under ignored `.runner/`. It does not verify live scheduler execution, real mail delivery, browser rendering or provider availability; those need explicitly scoped checks.

## Data recovery and capacity

The original Sites retirement snapshot and October 27 history recovery copies are historical local recovery artifacts. They are not a current scheduled backup of today's users, leagues, lists or notification state. Keep copies private and distinguish original-app recovery from current Cloudflare recovery.

The November 7 [backup/restore drills](backup-recovery.md) verified both stores locally and in isolated hosted Cloudflare D1 databases: exact schema/row matches, 2,527 history chunks, 9,928,635 locally decoded observations and all 36 saved rankings. Application checks read all 36 profiles and standings for four leagues against the hosted copies, with email disabled and no sending keys. All temporary databases were deleted; production remained healthy and unchanged. Before a destructive change, capture a fresh recovery point and matching source revision. The subsequent isolated Worker rehearsal verified existing Clerk session authentication, restored league/roster access and reload persistence, then removed the test Worker, domain and databases. These drills do not establish automatic/off-device backups, a fresh identity-provider login challenge or production traffic cutover. Do not upload raw GPS or private account/league data to public GitHub artifacts. See the [capacity audit](capacity-audit.md) for ongoing limits.

The app uses bounded Worker work, GitHub imports and D1 storage rather than R2. Email enforces its own shared send budget; provider quotas and account-wide usage still need monitoring. No claim of unlimited free capacity or automated backup coverage is implied. See [email notifications](email-notifications.md) and [bug reports](bug-reports.md) for retention and delivery limits.


November 7 race-notification release: main migrations 0014 and 0015 are applied in production; do not treat them as pending. Worker version 5f5e29bf-bc6b-49d6-a168-a96b9e8ca9dc passed live source/history/statistics verification and the next scheduled background tick. Scoring edge cases remain validated by the isolated season suite; no live race targets existed during release. Details: [capacity rehearsal production release](race-capacity-rehearsal.md).
