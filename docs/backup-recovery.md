# Private backup and recovery

The recovery unit is **both** D1 databases plus the corresponding source revision. Main DB contains leagues, account preferences, notification/email deduplication state, race evidence and history metadata; HISTORY_ARCHIVE holds most migration history. Restoring only one can leave references inconsistent.

## Non-disruptive capture

Cloudflare documents that its normal remote SQL export blocks other database requests while running. For a drill that must leave production available, `scripts/backup-drill.mjs` uses only SELECT queries against the D1 REST API. It never invokes a remote import, restore, scheduled handler or email job.

1. Create `.wrangler/private-backups` and restrict its Windows ACL to the current user and SYSTEM (remove inherited access). Verify `git check-ignore .wrangler/private-backups/check` succeeds. Never place exports in public artifacts, app assets, or a repository commit.
2. With Node 22.16+ and an existing authenticated Wrangler session, run `node scripts/backup-drill.mjs` from the repository root. It reads the saved OAuth session without printing it. Account/database IDs are explicitly allowlisted in the script.
3. Main tables are captured in one SELECT snapshot. Archive tables use small keyset pages; two complete archive captures bracket the main snapshot and must match byte-for-byte. Schema changes abort verification. Any failed run remains an **unverified** private capture; do not use it as a verified recovery point.
4. The script restores each SQL file into a newly created local SQLite file and checks integrity, foreign keys, complete schema and every row, including `sqlite_sequence` auto-increment counters. Triggers are installed **after** data loading so recovery does not generate new notification events. It reconstructs every history chunk, checks multipart continuity and decoded record counts, and recalculates saved migration rankings. Private `report.json` records hashes and aggregate results.
5. Run `node scripts/restore-smoke.mjs <absolute-private-run-directory>` for actual history/profile, ranking and league standings reads. Database handles are read-only, outbound fetch is blocked, and email is disabled with no provider/auth credentials. The delivery entry point must return `not-configured` without any network attempt.

This is a logical backup, not a distributed transaction across databases. The two matching archive passes detect concurrent changes; generation/record/ranking checks add consistency evidence. Schedule captures between imports and repeat if anything changes. Restore results describe the captured point, not later live updates. D1-managed internal tables are excluded. The present utility rejects virtual/WITHOUT ROWID tables rather than claiming unsupported coverage.

## Recovery procedure

1. Preserve the failed environment and identify a verified backup, its checksum report, source revision, and capture time. Retain the original backup untouched; work from copies.
2. Recover both stores into a separate local or isolated Cloudflare environment. For a hosted rehearsal, use new database IDs and a separate Worker with **no production routes, cron triggers, sync credentials, Clerk keys or Brevo key**. Set EMAIL_ENABLED and SYNC_ENABLED false. Never reuse production Wrangler bindings.
3. For a D1 import, use the tested hosted drill utility described below: large history INSERTs exceed D1's SQL statement limit, so it uses bounded parameterized writes. The hosted D1 import is verified; Worker deployment, authentication and traffic cutover still require separate validation before a real failover.
4. Repeat integrity, schema, row/hash, history and application checks before any traffic switch. Account authentication still depends on the separate Clerk instance; database backups do not back up Clerk, DNS, GitHub secrets or provider configuration. Reconfigure secrets securely rather than placing them in SQL/source archives.
5. **Keep email off during recovery.** Restoring an older snapshot can lose later accepted-message tombstones and replay already-sent email, beyond Brevo's short idempotency window. Reconcile accepted delivery state with the preserved newer DB/provider records or cancel pre-cutover pending work before deliberately enabling sending. Likewise reconcile post-backup league changes before cutover. Never use the restore drill to send test messages.
6. A real production replacement/cutover is separate from this drill and requires an explicit recovery decision. Preserve the old databases for rollback; do not test Time Travel against production.

## Scope and retention

Private local files provide a tested recovery copy but **not** an off-device disaster backup or an automatic backup schedule. Windows ACLs do not provide encryption at rest; use a user-controlled encrypted/offline destination for a second copy if desired. Do not configure external backup storage without choosing an approved private destination. No new paid services are required for the local drill.

Reference: [Cloudflare D1 import/export limitations](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## Isolated hosted D1 drill

`scripts/cloud-restore-drill.mjs <private-backup-directory> <phase>` supports `preflight`, `restore`, `verify`, `app-check`, `cleanup`, and `audit`, in that order. It provisions only two temporary D1 databases; it does not create a Worker or expose a public URL. All access uses the authenticated Cloudflare API. Targets are recorded in the private `cloud-restore.json`; every query and deletion rejects production database IDs. Cleanup also verifies each temporary database's name remotely; audit confirms their removal and production health.

Preflight checks database count, storage and account-wide UTC-day D1 usage, leaving substantial headroom for production. A separate per-drill row budget stops excessive work. No plan upgrade or paid service is configured. Metrics can lag; do not run near daily quota limits.

The importer verifies the SQL backup checksums, stages them locally, and uses parameterized multi-row inserts under D1's bound-parameter limit. Binary history is transmitted as hex parameters and reconstructed with `unhex(?)`, avoiding the SQL text-length limit while preserving BLOB types. Parent tables load before foreign-key dependents; auto-increment counters are preserved and triggers are created last. If an import fails, use `cleanup` on its test targets and restart; never retry against production.

Verification compares every hosted row and schema object with the staged backup and runs D1's supported `quick_check` and `foreign_key_check` (full SQLite `integrity_check` is not exposed by D1). The application check runs the actual app's history, rankings and standings functions locally against the restored hosted D1 databases through a read-only API adapter. Email is disabled with no sending keys; application outbound requests other than the controlled Cloudflare database adapter are blocked. This verifies hosted database recovery, **not** a deployed Worker, Clerk login or domain cutover. Delete temporary databases after verification; retain only the private local backup and verification report.

## November 7, 2026 drill

Source revision: `569139dc7ecabc890ca4bf00fd0e6c495521e771`. Private capture directory: `.wrangler/private-backups/2026-11-07T18-04-15-510Z/`. Main snapshot was taken during the successful verification pass starting 18:12:54 UTC; the archive's first capture began earlier. The archive reread matched exactly. Initial query-limit/authentication interruptions were resolved before verification; partial captures are not recovery points.

- Main: 637 rows across 22 application/migration tables plus `sqlite_sequence`; SQL 1,207,317 bytes.
- Archive: 2,538 rows across three application/migration tables plus `sqlite_sequence`; SQL 271,253,128 bytes.
- Both restored schemas and every row matched their SQL backups; integrity and foreign-key checks passed.
- All 2,527 monthly chunks and nine multipart pieces reconstructed successfully, totaling 9,928,635 stored observations. All 36 stored rankings matched recalculation from restored history.
- Actual app code read 36 history profiles, 36 rankings and standings for all four stored leagues. No stored race results/audit rows existed at this point, so this drill does not claim recovery of populated live race evidence.
- Email entry point returned `not-configured`; outbound fetch attempts were zero. Production health reported OK before and after. No production writes, deployment changes or scheduled handlers were invoked.
- The successful resumed verification used 224 read API requests / 3,828 reported rows read and finished in 212 seconds, including archive comparison and restore checks. These figures exclude earlier interrupted capture attempts and the later application smoke check; they are not a full incident recovery-time guarantee.

Checksums and per-table counts are retained in the private report. The source ZIP contains tracked app code/configuration, not hosted secret values. Keep production email disabled during any future real recovery until delivery tombstones and post-backup changes have been reconciled.

## November 7 hosted verification

Completed at 18:34 UTC using the same verified private backups. Both databases were restored into new Cloudflare D1 databases with no Worker bindings, routes, cron schedules or email/authentication keys. All 637 main rows and 2,538 archive rows matched exactly, including binary data, auto-increment counters, indexes and triggers. Both D1 quick checks and foreign-key checks passed. The archive is therefore identical to the previously decoded and verified 9,928,635-observation backup; it was not re-decoded inside a Worker.

The actual application's read functions, running locally against hosted D1 via the authenticated API, loaded 36 profiles, 36 rankings and standings for four leagues. Email returned `not-configured`, with zero external application requests. No hosted Worker execution, browser login or traffic cutover was claimed.

The drill reported 11,539 rows read and 6,853 rows written, including successful queries during initial importer corrections. Preflight showed roughly 891,000 daily reads and 6,930 writes, two databases and 140 MB stored, leaving ample free-plan headroom. No paid services or plan changes were introduced. Initial attempts exposed REST batch-format and foreign-key ordering requirements; the final utility handles both. D1's unsupported full integrity pragma was replaced with its documented quick check plus complete content comparison.

Both temporary databases (including earlier partial attempts) were deleted. Final inventory contained only the two production databases, and live health was OK with production email still configured. Private backups and `cloud-restore.json` remain local in the access-restricted backup directory; no backup data or private diagnostics were committed or uploaded to GitHub. Automatic backups, off-device backup retention, hosted Worker deployment and real failover remain separate work.

## Full app rehearsal — completed and removed

On November 7, a second pair of isolated D1 databases was restored and fully verified from the private backup. The app was built from its saved source ZIP in a private working directory and deployed as `fantasy-stork-league-recovery-drill` at `recovery-drill.storkleague.fans`. Production bindings, deployment and traffic were unchanged.

The test Worker had no cron schedules or sync/email-provider credentials. EMAIL_ENABLED and SYNC_ENABLED were false. A private expiring gate protected every page, asset and API; background job and sending endpoints were blocked. The user installed a separate Clerk production secret through a hidden-prompt helper. The existing Clerk identity provider was intentionally shared; the databases and Worker were isolated.

Verification completed at approximately 19:45 UTC:

- Existing Clerk SSO authenticated successfully against the restored backend. The browser displayed the user's two active leagues, opened a trading-stage league with both manager rosters (12 birds total), loaded its map/trails, and preserved access and the selected league after reload.
- This exercised an existing signed-in session, not a fresh Google credential challenge or email-code flow. Shared Clerk account settings and sessions were not modified.
- Requests without the private gate returned 404. Gated anonymous league reads exposed no leagues; invalid bearer sessions returned 401. Synthetic league integration tests passed outsider/member/host authorization checks; a second real-account browser session was not tested.
- The restored Worker served all 36 rankings, with authentication configured and email/scheduling disabled. No emails were sent or background jobs invoked.

At 19:48 UTC the test custom domain and Worker were deleted, followed by both test databases. Inventory confirmed the production Worker/domain remained and only the two production databases existed; production health was OK and its email configuration remained intact. Worker deletion removed its hosted secret bindings. The user subsequently confirmed revoking the separate recovery-drill Clerk key, completing credential cleanup; existing production keys were left intact.

Private backups and aggregate verification evidence remain in `.wrangler/private-backups/app-failover-2026-11-07/`. No backup or private account/location evidence was uploaded to GitHub. No paid services were introduced. This verifies isolated app recovery with the existing identity provider, not a production traffic cutover, independent identity-provider recovery, automatic backups or off-device retention.


## Archive-sharding recovery

The backup tool derives its store inventory from the configured D1 bindings and saves that mapping in its private report. Every archive is captured twice around the main snapshot; any difference fails verification. Read-only transient failures retry up to three times. Two bounded eight-row pages may be in flight, but output is ordered. Local restoration checks all schemas/rows, integrity, multipart generations, decoded record counts and reconstructed rankings. An incomplete/failed capture is never a verified recovery copy.

`restore-smoke.mjs`, `cloud-restore-drill.mjs` and failover configuration preparation now include every store in the backup report. Hosted drill quota preflight reserves a database slot for each restored store, and destructive-target guards include every current production D1 ID. These generalized hosted helpers have syntax checks; this release's new multi-shard functional restore test is isolated local SQLite, not a new hosted failover exercise.

Recovery must retain the placement directory (main migration 0017), all archive databases, their binding names and `HISTORY_SHARD_COUNT`. Restore source and configuration from the same release. Before the shard-aware Worker rollout, the pre-release backup intentionally captures the live main/original archive; the new empty second archive is not yet a live data source. `BACKUP_CONFIG` can identify that saved pre-release configuration. Never use an incomplete configuration to back up a live multi-shard app.
