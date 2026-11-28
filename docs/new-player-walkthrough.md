# First-player launch walkthrough

The automated journey runs with synthetic identities and locally mocked API responses. All non-local requests are blocked. It does not contact Clerk, Movebank, production leagues or an email provider. No runtime keyboard/focus behavior is changed.

Run `npm run test:new-player`; set `AUDIT_BROWSER=firefox` for Firefox. Both browser jobs run this journey as part of the existing required checks. Each tests 1440px desktop, 390px mobile and 320px narrow mobile in light and dark themes. Screenshots remain in ignored `.runner/new-player` or on the disposable CI runner.

## Automated acceptance checks

- A signed-out invitation opens My leagues and offers sign-in.
- The leading-zero invitation survives simulated sign-in and username selection.
- A missing or over-15-character username cannot create/join a league.
- Short codes fail browser validation; an unavailable code gives an error without joining.
- A simulated 503 preserves the code and permits retry. Two rapid submit clicks result in one successful join request and one membership.
- A host-started draft notification opens the correct league and marks the notification read.
- An accented bird name can be searched and selected. Drafting requires selection and the player's turn; a successful pick enters the waiting state.
- All in-app notification categories are enabled and all available email categories disabled by default.
- No page overflow, browser errors, or external requests occur.

API responses are mocked here to exercise the UI. The existing `tests/league-flow.mjs`, permissions, notification storage and full-season suites separately exercise actual server handlers with isolated databases and mocked authentication/email.

## Real account and physical-device acceptance — still to perform

Use a separate test identity and an explicitly isolated private league. Do not repurpose a real league. Keep notification email options off. Google sign-in avoids intentionally requesting email verification messages; provider security challenges cannot be guaranteed absent.

1. On a desktop signed out of the app, open the isolated league's invitation. Create/sign in to the test account through Clerk and choose a unique username of 15 characters or fewer. Confirm the invitation remains available and the player can join once.
2. On an actual phone, open the same invitation in its normal browser. Sign in with that test identity. Confirm the existing membership opens without duplication. Record phone, OS and browser versions.
3. In the isolated league, have the host start drafting. Open the bell, follow the turn notification, select a bird and submit one pick. Confirm the flock and waiting-for-turn state. Repeat in light/dark mode and check the phone keyboard does not cover the code/search fields or submit buttons.
4. Reload and switch away/back. Confirm the pick persists and the invitation cannot create another membership. Check settings show in-app on and email off; leave email off.
5. Record any confusing step and whether the player could complete it without coaching. Do not mark real Clerk signup, Google redirects, OS dialogs, installed-PWA behavior or physical touch performance verified from the mocked browser suite.

These checks can be done during the pilot. This test-only change requires no production deployment and does not reset the ongoing 24-hour production observation window.
