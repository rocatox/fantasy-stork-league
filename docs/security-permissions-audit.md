# Security and permissions audit

Reviewed November 7, 2026 Eastern using synthetic accounts and SQLite fixtures.
External authentication and email calls were mocked. No production league write,
real invitation redemption, brute-force traffic, test email or account change was
used. This is an application audit, not an independent penetration test or a
guarantee that all vulnerabilities have been found.

## Findings fixed

| Finding | Change |
| --- | --- |
| League/list/notification writes parsed an unbounded body | Read at most 16 KiB of actual streamed bytes, including when Content-Length is absent or false; malformed input returns 400, oversized input 413 |
| Removed test-email UI still had a callable endpoint action | Removed `testEmail` from the public notification writer; retained delivery compatibility for already queued messages and isolated sender fixtures |
| Account-only invite limit could be bypassed by rotating accounts on one network | Retained 10 attempts/account/10 minutes and added 30 attempts/Cloudflare client IP/10 minutes, atomically enforced |
| Any authenticated league write ran global league maintenance | Scope request-driven maintenance to that user's leagues; scheduled global maintenance remains intact |
| Nonmembers could distinguish an existing disbanded league from a missing league by status response | Check membership before returning private state-specific errors |
| Missing anti-framing policy | Static app responses set CSP `frame-ancestors 'none'`, X-Frame-Options DENY, nosniff, and strict-origin-when-cross-origin referrer policy |
| Development-tool dependency advisories | Updated Vite, Cloudflare Vite plugin and Wrangler within their existing major versions, plus required matching Worker type definitions; refreshed lockfile |

Write content types now require the exact application/json media type (parameters
such as charset remain valid), in addition to the existing same-origin check.
The new network limiter trusts only Cloudflare's `CF-Connecting-IP`, not
X-Forwarded-For. It stores a SHA-256 key incorporating the address and ten-minute
window; raw addresses are not stored. Obsolete network buckets are pruned on
subsequent join attempts. Limits include successful and unsuccessful attempts;
shared-network users may receive a temporary 429. This is a mitigation, not a
defense against an unlimited distributed/account-creation attack.

## Permission and integrity checks

- League reads select memberships using the authenticated server identity.
  JSON owner/user/member fields cannot impersonate another manager. Nonmembers
  cannot start, leave, disband, draft, trade, swap or replace within a private league.
- Only the host can start/disband; hosts cannot use the member leave action.
  Existing invite-only leave rules and the eight-member/six-active-league limits
  remain enforced. Six-digit codes preserve leading zeros and remain bearer
  invitations: anyone with a valid code can join while the lobby permits it.
- Trade ownership and proposer/recipient permissions, three pending proposals,
  draft turns, roster ownership, eligibility and deadlines remain server-side.
  Existing integration tests verify competing draft writes, accept/decline races,
  duplicate pool claims and late commits are rejected by revision/deadline guards.
- Private list reads/membership/deletes and notification reads/preferences use
  the authenticated account ID. Foreign IDs and forged user fields do not allow
  cross-account changes. Email unsubscribe continues to leave in-app settings intact.
- Bug reports retain authenticated ownership, bounded input, atomic per-user and
  global caps, idempotent retry, private storage, and a fixed owner email recipient.
- Actual sync/history/race/capacity handlers reject missing/incorrect admin bearer
  tokens before parsing bodies or accessing storage. Worker tests cover private
  operations/job gates. Public caching is restricted to anonymous roster/rankings,
  not private endpoints; private JSON responses remain no-store.
- The authentication wrapper restricts Clerk to session tokens and configured
  authorized parties, rejects failed/incomplete sessions, and takes identity from
  Clerk rather than request fields. The test stubs Clerk's verifier and checks how
  the wrapper handles its decisions; this is not a live forged-JWT/provider test.
- UI text uses React escaping; owner/player email templates escape message text.
  A narrow current-tracked-tree credential-pattern scan found no matching live
  key/private-key literals. It did not scan the entire Git history or provider
  dashboards and is not proof that no secret can exist elsewhere.

## Verification and constraints

`tests/security-permissions.mjs` adds isolated negative and concurrent tests.
`tests/auth-boundary.mjs` tests authentication delegation. Existing league,
list, notification, bug-report, email, public-cache, full-season and Worker-route
suites remain part of `npm test`. Provider sends are mocked. `npm audit` reported
zero known vulnerabilities after the patched toolchain update; advisory results
are time-sensitive and should be repeated periodically.

No paid feature, new database or schema migration is required. No keyboard,
focus, map interaction or CSS source was changed. The toolchain rebuild can change
generated JavaScript hashes; that does not reintroduce the rolled-back handlers.
Full CSP script restrictions are not introduced here because Clerk's runtime
requirements need separate compatibility testing; anti-framing is enforced now.
Keep monitoring actual CPU, request/write usage, and provider quotas. Public
history access is intentional; this audit does not change study access licenses.

## Release verification

Source revision `a05d07f` deployed as Worker
`4562ac60-7c48-4890-919d-5102b7a2d343`. All 179 unit tests and the complete
SQLite integration chain passed, including the new security/auth-boundary tests,
full-season rehearsal and mocked email tests. All 61 isolated Firefox UI,
scrolling, theme and failure-handling checks passed without browser errors.
Production build passed; the existing large-bundle warning remains. The final
invite-limit ordering adjustment was rechecked with security and league-flow
tests and rebuilt.

Read-only production checks confirmed HTTP 200, the four configured security
headers, signed-out 401 responses from lists/notifications/operations, eight
current source states with no overdue studies, and an idle email timer. No live
league mutations, test-email sends, schema changes or paid resources were used.
The frontend interaction source matches rollback revision 02e0393; generated
JavaScript hashes changed because the build tools were patched.
