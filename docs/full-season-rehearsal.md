# Eight-manager season rehearsal

Verified November 7, 2026 with `node tests/full-season-rehearsal.mjs` and the full `npm test` suite. The rehearsal is included in `npm test` so later changes rerun it.

## Isolation and scope

The test uses an in-memory SQLite database with the production race, notification-outbox and email migrations, a simulated 2027 clock, synthetic birds and authenticated-user stubs. It invokes the real league, race-writer, notification-delivery, email-delivery and inbox handlers. Real German boundary geometry and GPS arrival checks process the synthetic observations.

All Clerk/Resend HTTP calls are intercepted by a local fetch stub, which rejects unexpected destinations and returns synthetic responses. Email recipients use `example.test`. No production database, real league, credential, live source download or email delivery is involved. This is a combined backend integration rehearsal, not a browser usability, live provider-delivery or scheduling test.

## Verified sequence

1. Create a league, join seven other managers using its six-digit code, and repeat an existing member's join without another membership notification.
2. Complete six snake rounds with 48 distinct picks from 64 available synthetic birds.
3. Accept a two-for-one trade: one manager now has seven birds, another five. The accepting manager receives no self-action outcome notification.
4. Swap a bird from the pool. Cancel the now-impossible pending trade and notify the other manager, without notifying the swap actor of their own action.
5. Flag two inactive birds and two deceased birds. Recover one inactive bird before the race while inside the drafting-distance limit; replace one deceased bird through a swap. Reject replacements and swaps at the exact race-start cutoff.
6. Keep all 48 roster slots in race reconciliation, including flagged birds. Recover the second inactive bird during the race and clear its flag.
7. Detect migration from synthetic stopover-tolerant movement. Record notifications without inbox visits. Exercise all four My race / League race combinations, including managers whose email and in-app choices differ.
8. Confirm both recovered birds at the same arrival timestamp: each receives 47.5 points in the 48-bird league.
9. Import a delayed earlier arrival: it receives 48 points and lowers each tied bird to 46.5. Repeat imports without duplicate alerts or emails.
10. Withdraw that arrival's GPS evidence: retract its points and restore the two tied birds to 47.5.
11. Reconcile full season-end coverage and advance beyond the review window. Finalize two tied first-place managers and 46 nonfinishers, including the unreplaced deceased bird.
12. Verify final notifications follow My race updates only, contain the correct rank and points, and stay private. First inbox reads happen after the background work; an outsider sees no notifications.

## Results

- All rehearsal assertions passed, including 312 checks of race-event visibility/email routing across the scenario.
- 35 mocked email messages; zero real emails.
- Both recovered birds scored normally. No production implementation fix was needed.
- The full regression command passed: 157 unit tests plus the chained storage, league-flow, cleanup, notification, email, bug-report and trade-outcome integration suites.
- Structured results are generated locally at `.runner/full-season-rehearsal-result.json`. No GPS evidence is uploaded as an artifact.
