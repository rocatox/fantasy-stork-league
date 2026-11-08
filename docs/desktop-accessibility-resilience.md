# Desktop accessibility and resilience audit

Completed November 7, 2026 (Eastern), using isolated headless Microsoft Edge, synthetic accounts/birds/leagues, and mocked HTTP responses. The fixture imports the real React components. All external requests are blocked, service workers are disabled, and API routes are intercepted. No live leagues are modified and no emails are sent.

## Fixed findings

- Failed notification read actions previously closed the inbox and navigated away, hiding the error. They now keep it open until the write succeeds; notification items are disabled while a write is pending.
- Profile history failures now offer a Retry history button. Roster refresh failures have a persistent, accessible Retry tracking alert and retain already-loaded birds.
- Signed-in requests and the roster/profile-history reads now have a 20-second response-header timeout. Mutations are not automatically retried on timeout; the message asks the player to refresh and check whether the operation completed. Existing one-time authentication refresh on HTTP 401 remains. This timeout does not bound Clerk's getToken call or response-body streaming after headers arrive.
- League actions use an immediate ref lock as well as disabled buttons to reject repeated submissions before React renders the busy state.
- Closing a bird profile restores focus to its connected originating row or SVG marker when focus was inside the profile. Escape uses the current league identity when restoring the previous team filter.
- Added a keyboard skip-to-content link and general focus-visible styling. Searchable bird controls now support Home/End; nonsearchable controls support Space to select.
- Light-theme rule numbering had a measured contrast ratio of 2.63:1 on white. A darker gold text color fixes this while retaining the main theme colors.

## Verification

`tests/desktop-accessibility.mjs` records 37 assertions/scans in `.runner/desktop-audit-results.json`. All passed with zero browser exceptions. Axe WCAG A/AA scans found no remaining violations in the tested light/dark map, scouting, league, settings and rules pages, notification dialog, and the additional lobby/draft/completed league fixtures. Keyboard checks covered dropdown selection, Escape and focus return, sorting, dialog dismissal, skip navigation and profile focus return. Failure fixtures covered notification writes, history reads, initial and cached roster reads, and preference saves. A same-tick double swap click produced one mocked mutation. Notification pagination and reduced-motion application passed. A 720px viewport tested reflow equivalent to a 1440px desktop at 200% zoom, with no horizontal document overflow in the checked pages.

The isolated encryption/timeout/unit suites (179 tests) and full SQLite integration chain passed, including the full-season, race, notification and mocked-email suites. The production build passed with the existing large-chunk warning. A rendered desktop settings screenshot was inspected locally.

To repeat the optional browser audit, install Playwright and axe-core under the ignored `.runner/audit-tools` directory, then run `node tests/desktop-accessibility.mjs` from the repository root. It requires installed Microsoft Edge and local port 4197. App production dependencies are unchanged. Browser outputs and screenshots stay ignored; the checked-in fixture contains only synthetic data.

## Limits and follow-up

This is not certification of complete WCAG conformance. No manual NVDA/JAWS narration, physical browser zoom shortcut, Windows forced-colors review, or additional browser-engine comparison was performed. The fixture replaces Clerk account controls; it does not audit Clerk's hosted sign-in/account UI. Backend race correctness and notification delivery are covered by isolated integration tests, not real race or email traffic. The existing full-day CPU and first scheduled backup checks remain separate pending tasks.
