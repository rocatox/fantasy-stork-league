# Email notifications

Email is opt-in independently for the six existing notification categories. Existing in-app choices are preserved. Own bird updates use either own-race or league-race email preference, once per event; final results use own-race only. Opt-ins are prospective, including when a source event is processed late.

The account update atomically captures opted-in events in D1. The existing fifteen-minute Cloudflare timer drains in-app work then makes at most two separate email job invocations. No browser needs to be open. Each email combines up to 10 updates for one manager. The sender rechecks verified Clerk primary email, current preferences, membership and actionable prompt status. No raw GPS is included. Resend receives the email address and the league/update text.

Free-plan guardrails: 90 provider attempts per UTC day and 2,700 over the preceding 31 days (including the current UTC day), including ambiguous failures. Resend Free currently allows 100 emails/day and 3,000/month. Keep this account dedicated to this app or reserve capacity for other senders. No automatic upgrade is configured. Quota-limited email remains queued, but updates older than 48 hours expire; in-app retention is unchanged. Delivery is best effort, not a guarantee of inbox receipt.

Retries preserve the exact message and idempotency key, stop after six attempts, and never retry after 23 hours from the first attempt (Resend retains keys for 24 hours). A shared lease prevents concurrent sends. A successful provider response is recorded as accepted, not delivered. Terminal batches clear recipient/body payloads; event deduplication tombstones expire after 91 days. Invalid/unverified primary addresses are skipped. Resend handles its provider suppression list; no delivery webhook/inbox confirmation is implemented in this version.

Every email has a confirmation-page unsubscribe link and one-click List-Unsubscribe POST support. GET does not change preferences. Unsubscribe disables all email categories without affecting in-app alerts. Saving preferences or removing membership cancels pending messages on the next delivery check.

## Activation

Resend domain `notify.storkleague.fans` created (ID `053305ea-18d6-4db0-973e-a8eaa2496791`); five approved DNS records imported into Cloudflare. Sending-only API key restricted to this domain created. Hosted template `a62dc339-3d87-4f5b-8af9-01b2cf6a32c8` published in Resend's visual editor with SUMMARY, SETTINGS_URL, UNSUBSCRIBE_URL and LEAGUES_URL variables. The app sends escaped summaries (up to ten updates) and links to full league information. Activation/delivery verification still pending.

1. Create a Resend Free account. Add `notify.storkleague.fans` under Domains, for sending only.
2. Add the exact DNS records Resend provides in Cloudflare and wait for Verified. Do not replace existing website/Clerk DNS or root-domain mail records.
3. Create a Sending access API key restricted to that domain.
4. Run the local `outputs/Configure-Email.ps1` helper. It accepts the key hidden, validates it against Resend's synthetic `delivered@resend.dev` address and installs `RESEND_API_KEY`, `EMAIL_FROM=updates@notify.storkleague.fans`, and `EMAIL_ENABLED=true` as Worker secrets. No key goes into Git, chat or command arguments.
5. Check `/api/health` for `emailConfigured:true`. Enable desired email categories in Settings. Confirm a real, newly created notification is accepted and arrives in the verified primary inbox; then verify the scheduled sender.

Disable sending without changing saved preferences by setting EMAIL_ENABLED=false. Never manually replay accepted batches.

Validation: `node tests/notification-email.mjs` exercises channel scopes, opt-in timestamp, transactional capture, verified primary recipient, batching, escaping, same-key retries, unsubscribe, quota, concurrent locking and retry expiry. Existing notification suites exercise offline capture and race deduplication. Desktop and 390px light/dark preview checked. Real delivery remains unverified until account setup completes.
