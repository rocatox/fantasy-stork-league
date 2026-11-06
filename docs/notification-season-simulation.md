# Migration notification season simulation

Verified 2026-11-06. Run `node tests/notification-season.mjs` or `npm test`.

## Scope

Local synthetic 2027 season with four managers and eight drafted birds. The test drives Movebank-shaped observations through the production `arrivalCollector`, authenticated race claim/commit handler, actual SQLite outbox triggers, production background tick/delivery pump, standings, notification preferences API and inbox GET handler. Only authentication identity, external HTTP transport and the D1 adapter are test substitutes. No production leagues, notifications, GPS records, accounts or settings are changed; no external requests are made.

## Results

Four birds migrated, one per manager. Four controls (local wandering, a GPS spike, an out-and-back trip and missing daily coverage) did not produce departure alerts and remained nonfinishers.

| My race updates | League race updates | Visible departure alerts |
|---|---|---:|
| On | Off | 1 (own bird) |
| Off | On | 4 (all managers, including own) |
| On | On | 4 (own bird counted once) |
| Off | Off | 0 |

- Settings were saved through the actual preferences endpoint before the simulated app closed.
- All departures were recorded before the first inbox GET. First reads returned persisted, unread alerts and did not advance background snapshots.
- A confirmation uploaded three days late produced one alert once sufficient observations arrived.
- Interrupted delivery after the first recipient was saved left the outbox pending; a subsequent pump invocation completed delivery without duplicating that recipient's alert.
- Same-slot reimports, replayed source snapshots, rejected reuse of a consumed import lease, and source withdrawal followed by restoration did not duplicate departure alerts.
- Enabling settings afterward did not resurrect suppressed departures.
- Four corroborated German arrivals followed the same toggle matrix.
- Final results settled while the simulated app was closed and followed **My race updates only**, including each manager's rank and points. Repeated background runs did not repeat final results.
- Unrelated accounts could not read the league's alerts. Inbox records contained no raw GPS evidence.
- The queue drained to zero. Maximum delivery SQL queries in this four-manager test: 12 per invocation, below the free-plan per-invocation query ceiling. This does not measure hosted CPU or independently verify Cloudflare cron scheduling.

The full existing suite passed (151 unit tests plus integration scripts); the completed season simulation also passed independently after adding the delayed-upload case. No application-code correction or deployment was required.
