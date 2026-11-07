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
3. For a D1 import, adapt transaction wrappers to D1's import requirements. Large history INSERTs may exceed D1's SQL statement limit; use bounded parameterized writes through an isolated import utility instead. The local SQLite drill does not prove a hosted D1 import or platform failover. Validate these separately before any hosted cutover.
4. Repeat integrity, schema, row/hash, history and application checks before any traffic switch. Account authentication still depends on the separate Clerk instance; database backups do not back up Clerk, DNS, GitHub secrets or provider configuration. Reconfigure secrets securely rather than placing them in SQL/source archives.
5. **Keep email off during recovery.** Restoring an older snapshot can lose later accepted-message tombstones and replay already-sent email, beyond Brevo's short idempotency window. Reconcile accepted delivery state with the preserved newer DB/provider records or cancel pre-cutover pending work before deliberately enabling sending. Likewise reconcile post-backup league changes before cutover. Never use the restore drill to send test messages.
6. A real production replacement/cutover is separate from this drill and requires an explicit recovery decision. Preserve the old databases for rollback; do not test Time Travel against production.

## Scope and retention

Private local files provide a tested recovery copy but **not** an off-device disaster backup or an automatic backup schedule. Windows ACLs do not provide encryption at rest; use a user-controlled encrypted/offline destination for a second copy if desired. Do not configure external backup storage without choosing an approved private destination. No new paid services are required for the local drill.

Reference: [Cloudflare D1 import/export limitations](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

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
