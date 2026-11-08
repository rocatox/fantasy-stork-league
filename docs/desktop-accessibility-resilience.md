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

To repeat the browser audit, run `npm ci`, install browsers with `npx playwright install chromium firefox`, set `AUDIT_BROWSER=chromium` or `firefox`, then run `npm run test:browser`. Without an override, Windows uses installed Edge. Local port 4197 must be free. Playwright and axe-core are pinned development dependencies. Outputs/screenshots stay ignored and fixtures contain only synthetic data. The suite now also runs automatically in GitHub Actions.

## Limits and follow-up

This is not certification of complete WCAG conformance. No manual NVDA/JAWS narration, physical browser zoom shortcut, Windows forced-colors review, or additional browser-engine comparison was performed. The fixture replaces Clerk account controls; it does not audit Clerk's hosted sign-in/account UI. Backend race correctness and notification delivery are covered by isolated integration tests, not real race or email traffic. The existing full-day CPU and first scheduled backup checks remain separate pending tasks.


## Forced-colors and assistive-technology follow-up — November 7

The user elected automated checks only after native Narrator launch did not expose a controllable window and the Windows contrast shortcut did not change the appearance. No Narrator process remained running; no Windows theme change was confirmed. This follow-up does **not** claim a listening test with Narrator/NVDA/JAWS or verification of an actual Windows contrast theme.

Inspected Edge's native Windows accessibility tree in a separate headed browser with the synthetic fixture: named navigation, league controls, team lists, notification trigger, map marker buttons, playback controls and timeline were exposed. Browser assertions additionally verify the timeline's human-readable `aria-valuetext`, dropdown active-descendant references, no-results announcement, and keyboard/focus behavior.

Fixed editable-search Home/End keys intercepting native caret movement; Home/End still navigate nonsearchable lists. Empty lists cannot reference a nonexistent active option. Added forced-colors selection/focus outlines, selected-option underline/border, current league phase underline, system-color disabled controls and starred icons, visible dialog borders, native select arrows, and removed scroll fades in forced colors. Confined palette preservation to logo artwork and the map SVG overlay so the white logo remains visible and country shapes match the canvas geography; surrounding controls continue using system colors.

The extended isolated browser suite covers light/dark forced-color emulation on all five pages and the notification dialog, in addition to the original failure and keyboard checks. Axe's color-contrast rule remains enabled for normal themes, but is excluded in forced colors because its authored-color calculation reported navy-on-black while the screenshot rendered white text on black. Forced-palette visual checks use screenshots instead; structural axe checks remain enabled. This is browser emulation, not a substitute for a real assistive-technology user test. No live league writes, account changes, database migrations, or email sends are part of this audit.


## November 8 automatic regression checks

The new keyboard/focus behavior described in the historical audit was subsequently rolled back after the user reported Zen scrolling freezes. Current tests assert that the skip link stays absent, profile closure does not restore focus to a bird, visible timelines do not cause unnecessary selection scrolling, and delayed history does not fight manual scrolling. The first automatic Linux Chromium and Firefox runs each passed 61 checks with no browser errors. These tests do not reproduce or certify against a physical system-wide trackpad freeze. No production interaction code changed for CI.
