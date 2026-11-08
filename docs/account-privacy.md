# Privacy information and private requests

Settings → Account → Privacy & account data contains the player-facing privacy
information and request form. The public permalink is
`/?view=settings&section=privacy`; reading the information does not require sign-in.
Submitting a request requires a valid Clerk session. The footer links to this
same section, rather than maintaining a second privacy page.

Requests use the existing private `bug_reports` storage with `area='privacy'`.
They inherit streamed body limits, authenticated ownership, same-origin checks,
five submissions per account per day, global capacity limits and idempotent UUIDs.
The existing owner-email queue sends a **Privacy request** message using the
private `BUG_REPORT_EMAIL` setting, shared Brevo limits and retries. No recipient
address is supplied by the browser. The form asks for the player's reply address;
this is part of the privately stored and forwarded request, not an instruction
to send automatic mail to that address. There is no public request-read endpoint.

## Automatic deletion

The separate Delete account disclosure requires an exact DELETE confirmation and
Clerk `strict` reverification. POST `/api/account` accepts only a same-origin JSON
request and the authenticated account ID; client-supplied identity fields are
ignored. Repeat accepted requests return the existing job. The UI signs out after
acceptance and clears current-device account preferences and browser-local stars.
Other devices' local browser storage cannot be remotely erased.

Migration 0019 adds a durable private deletion receipt, work cursor, lease and
identity registry. Receipt insertion and removal of the account's lists, list
memberships, notifications, email queue/envelopes, reports/report mail and join
rate state commit atomically. Sender/delivery leases prevent accepting deletion
in the middle of an app email send. Existing provider-accepted emails cannot be
recalled. Auth and database guards reject stale-session reads/writes and prevent
private data from being recreated by requests already in flight.

The existing minute timer pumps at most 20 isolated cleanup requests. Each handles
one relevant shared row; unrelated rows are filtered in SQL rather than requiring
one Worker call per row. No paid queue, object store or new hosting service is used.
Cleanup updates leagues, cycle/outbox snapshots, other inboxes and queued mail,
then deletes the Clerk identity. A Clerk 404 is treated as already deleted. Safe
failure categories and exponential retries (up to one hour) persist; retries do
not depend on the player keeping the app open. Completion clears transient league references, retaining only the minimal receipt/cursor/timestamps needed
to block resurrection and preserve the stable anonymous roster ID.

Policy:
- Invite-stage membership is removed; empty lobbies disband.
- Hosting transfers at every stage to the longest-standing remaining manager.
  Join order is recorded before future draft shuffles. For older already-drafted
  leagues without it, the user approved the first remaining stored member as the
  fallback. Draft order is never re-sorted for a transfer.
- Drafted membership, roster ownership, bird evidence, ranks and points are retained
  under Deleted manager. Identity photos, email/name fields are removed. Pending
  trades involving the deleted manager are cancelled; no new trade may target it.
- An incomplete draft retains its existing turn/order and disbands at the normal
  deadline if still unfinished. No replacement manager or automatic picks are added.
- Older notifications lack reliable structured actor metadata. Their text in
  affected leagues is replaced with a neutral earlier-update message, while the
  event remains in-app. Affected queued mail is cancelled/cleared rather than
  rewriting an already-attempted idempotent provider request. Unrelated league
  events, settings and queued messages are preserved.
- During the short shared-record cleanup, player notification delivery pauses.
  It resumes before Clerk retries so a provider outage does not hold up other
  players. Operational alerts can still be delivered. Pending cleanup over an hour
  raises the existing operational alert; no personal details enter that alert.

Clerk's own account UI/dashboard deletion is reconciled separately: at most 20
known account IDs are checked per 15-minute discovery tick, with alive accounts
checked at most daily. Only a complete successful filtered Clerk response with
at least one known live identity may queue cleanup. Provider errors, partial
results and an all-missing batch fail closed and surface an operational warning;
those cases require operator inspection rather than risking mass deletion.

## Activation and recovery

This implementation remains gated by ACCOUNT_DELETION_ENABLED=false until
migration 0019 has been applied. Deployment order: verify the private backup,
apply the main D1 migration, set ACCOUNT_DELETION_ENABLED=true, build and deploy
through the protected-main workflow. The public config exposes only whether the
feature is enabled. The job endpoint requires SYNC_SECRET; the deletion ledger
and request details have no public read endpoint. No new secret is required.

Encrypted backups retain seven daily and four weekly recovery points. Do not
serve an older restored database before reconciling deletions. Preserve the
latest private `user_id,alias,requested_at` deletion receipts before replacing a
database and use the newest private backup receipts if the live database is lost.
In the isolated restore, call `reapplyDeletionReceipt` one receipt at a time and
finish `processDeletion` before the next receipt; it preserves the original alias,
blocks access immediately and re-removes restored private data. Keep emails and
public routes disabled throughout recovery. Run Clerk identity reconciliation
before serving the restored app; investigate any fail-closed discovery state.
Never put receipts or decrypted backups into GitHub artifacts, logs or the repo.
The replay helper has no public HTTP route and is tested only with isolated data.

## Verification

`tests/account-deletion.mjs` uses SQLite, synthetic identities, injected storage and
Clerk failures, and mocked provider emails. It checks reverification, ownership,
CSRF, confirmation, initial rollback, stale writes, retries, host transfer, roster
preservation, exact historical scores, queue deduplication, continued unrelated
mail delivery and replaying a receipt against an older restored snapshot. It also
checks that direct-Clerk discovery cannot delete accounts on an outage or an
unverified all-missing response. Tested cleanup invocations use at most 13 queries,
below the Free D1 per-invocation query budget.

Browser fixtures exercise confirmation and accepted deletion in both themes at
1280px and 390px. Existing keyboard/focus rollback checks remain enabled. No real
account/league is deleted and no real email is sent by these tests. Live Clerk
reverification and deletion are not claimed as tested with a real user.
