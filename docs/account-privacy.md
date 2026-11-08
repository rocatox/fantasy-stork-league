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

## Review, not immediate deletion

Submission requests operator review. It does not delete Clerk users, mutate
leagues, export records, or change notification settings. The receipt says this
explicitly. The automatic account-deletion backend is not implemented by this
change. Never treat a successful request receipt as completed deletion.

Before disclosing data or processing deletion, verify the authenticated owner of
the stored request; a typed reply address alone is not proof of ownership.
The approved deletion policy is to remove invite-stage membership, transfer
hosting to the longest-standing remaining manager, and retain drafted rosters
and historical results as “Deleted manager.” Incomplete drafts still expire at
the normal deadline. Actual cleanup must cover private lists, notifications,
queued email, reports, shared league identities, Clerk and restoration from old
backups; merely deleting the Clerk identity is insufficient.

Tests use SQLite fixtures and intercepted localhost browser requests. They
verify privacy submissions, retry deduplication, owner-message labeling and HTML
escaping, plus expanded settings in light/dark at 1280px and 390px. No real
accounts or leagues are changed, and no email is sent by the tests. No map,
keyboard, or focus behavior is changed.
