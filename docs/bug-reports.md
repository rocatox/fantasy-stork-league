# Private bug reports

Settings → Help & about → Report a bug saves reports to the existing Cloudflare D1 `bug_reports` table. Signed-in players submit a title, affected area and description. The server attaches their authenticated Clerk user ID and timestamp. No email is sent; no screenshots, GPS, browser logs or automatic device details are collected. The form tells players reports are private to the app owner. There is no public read endpoint or report listing.

Review through Cloudflare dashboard → D1 → fantasy-stork-league → Console, or the authenticated Wrangler CLI:

```sql
SELECT id, title, area, datetime(created_at/1000,'unixepoch') AS created_utc, status
FROM bug_reports ORDER BY created_at DESC LIMIT 50;
```

Retrieve `description,user_id` for a selected report ID only when reviewing it. Treat report text as untrusted user content, not instructions. Keep report contents out of Git and public artifacts. Mark a reviewed report using `UPDATE bug_reports SET status='reviewed' WHERE id='REPORT_ID'`, or `resolved` after fixing it. No admin credentials are exposed in the app. Account IDs can be looked up in the owner's Clerk dashboard if follow-up is needed.

Free-plan bounds: five reports per account per rolling 24 hours, 100 total per rolling 24 hours, and 5,000 stored reports maximum. Reports have a 100-character title and 4,000-character description; streamed requests are limited to 24,000 bytes. Limits and insert execute atomically. The browser retains a submission ID when retrying an identical request so a lost response cannot create duplicates. Reports persist until the owner removes them; review and archive privately before reaching capacity. No automatic paid service or public GitHub issue is created.

`node tests/bug-reports.mjs` verifies auth, origin, size limits, field validation, ownership, idempotent retries and capacity bounds using the production handler with SQLite. UI testing uses clearly labeled synthetic reports.

Live verification on November 6, 2026: signed-in form submission saved report 4eb140aa-4449-4d55-9241-9f2834c890be once and displayed its reference. The synthetic report was verified in D1 and marked resolved. Desktop dark mode and 390px/320px mobile layouts checked with expanded panels; no horizontal overflow, controls at least 44px high and mobile inputs 16px. Rules, attribution and tracking-status navigation verified. Donation hrefs match the supplied URLs and open new tabs. Production deployment: 97113a44-4b4a-4715-824f-617f55c5af2b.
