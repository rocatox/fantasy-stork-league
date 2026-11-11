# Mobile UX audit — November 10, 2026

The isolated browser harness covers 320px and 390px portrait layouts in light and dark mode, plus an 844px landscape map. It exercises navigation, scouting profiles, lists, expanded rules and privacy/report forms, invite/draft/trade/race layouts, and touch timeline controls. Chromium additionally tests one-finger map panning and two-finger pinch zoom. Existing notification UI checks cover long memorial messages, read/unread flows and outside dismissal at the same portrait widths.

## Improvements

- Small search, settings and timeline form text now uses 16px at mobile/tablet widths, improving readability and avoiding the small-text trigger for iOS focus zoom.
- The narrow standings table no longer forces the Points column out of view through an oversized Player column.
- Mobile checks run alongside both browser regression jobs with synthetic accounts, API responses and no external requests or emails. Screenshots remain local/disposable and are not uploaded as artifacts.

## Verification and limits

The local Chromium audit passed 53 layout/accessibility scans, with no page overflow or browser errors, plus touch pan, pinch, scrubber, play/pause and follow assertions. Visible controls are also inventoried for small targets and form text. No keyboard/focus runtime behavior was added.

This is viewport and synthetic-touch testing, not physical-device certification. Real iOS Safari keyboard behavior, installed-PWA safe areas, OS account dialogs, and performance on low-memory phones remain useful device checks. Mock history is intentionally small; this audit does not establish dense-trail frame rates or validate the third-party Clerk account UI.
