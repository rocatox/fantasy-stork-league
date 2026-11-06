# Migration-start notifications, version 2

## Detection

This is an inferred, conservative spring-migration signal, not a biological departure date. It runs on the existing season GPS import in GitHub Actions; no extra Movebank requests, browser processing, paid storage, or new timer are required. The existing durable D1 outbox records delivery while the app is closed.

The collector applies the same visibility, species, individual/deployment, mortality and duplicate-correction gates as arrival evidence. The shared GPS spike/speed screen then excludes suspect fixes. Daily locations use the first pair of fixes at least 30 minutes and at most six hours apart, within 20 km, on the same solar day. Daily anchors must be on consecutive days, 16–32 hours apart, with the same tag.

A signal requires:
- Five baseline daily anchors all within 50 km of the last baseline anchor.
- At least three daily displacements of 60 km or more within three to five consecutive observed days. One or two stopover days are allowed; missing daily coverage is not.
- At least 300 km net displacement, and net/path ratio >=0.7.
- At least 150 km progress toward a fixed central-Germany reference (10.45 E, 51.16 N). This is a direction proxy, not the precise border distance used for eligibility or race scoring.
- An additional confirmation day still at least 300 km from baseline and 150 km closer to that reference.
- Confirmation before the first corroborated German arrival and before race end. No post-arrival excursions can become departure signals.

The signal normally confirms roughly three to five days after the first moved daily anchor (about four to six days after the final baseline anchor), plus feed latency. Gaps, short migrations, long stopovers, changing tags or missing paired daily fixes can prevent detection. Absence of this alert does not mean a bird is stationary. No arrival, point, typical-date or migration-success calculation is changed.

The Worker independently rechecks the bounded 18-, 20- or 22-fix evidence before accepting it. Only dates/version enter standings and notification accounts; GPS evidence stays in race storage. One migration notification per bird/league/season; retries and later reconfirmations do not repeat it. Old confirmations preceding notification enrollment do not create a historical flood.

## Research basis and limits

The daily-displacement concept is informed by [Acácio et al. (2023), Timing is critical](https://doi.org/10.1186/s40462-022-00328-3), which identified autumn departures using three consecutive roost-to-roost movements over 60 km after leaving the breeding area. Our paired daily anchors, spring direction, stationary baseline and extra confirmation are app-specific adaptations, not a validated replication of that method. [Rotics et al. (2018)](https://doi.org/10.1111/1365-2656.12898) used stationary five-day periods and retrospective northward crossing context to identify spring departures; a retrospective method cannot directly deliver an immediate notification.

No independent departure labels exist in our archive, so these checks cannot establish sensitivity or a false-positive rate. The priority is avoiding speculative alerts, accepting missed or delayed alerts. In-app wording is “Migration detected” and explicitly calls it a tracking estimate.

## Historical replay

Local, source-resolution recovery snapshot dated 2026-10-27: **30 birds, 166 January–June bird-seasons**, including partial years and 20 first seen inside Germany. Version 2 reproduces the audited **90** signals, versus 53 for v1: 38 additions and removal of the suspect Olli 2020 signal. Of the additions, 36 have later corroborated spring arrivals; no added signal returns within 50 km of its baseline in the following 30 days of available paired daily observations. These are supporting checks, not independent departure labels.

Production-code replay checks all 166 outcomes against the audit and revalidates every emitted evidence packet. For all 90 signals, raw-observation prefix checks verify detection at confirmation and no signal before the final confirming fix. Synthetic and server tests cover observed stopovers, evidence lengths, 300 km at both stages, missing days, outliers, local movement, return trips, southbound travel, sparse fixes, changed tags, future observations and unchanged arrival-scoring revisions. GPS evidence stays local during these tests. See [the investigation report](migration-start-audit-2026-11-06.md) for limitations and alternatives rejected.

## Routing and UI verification

- My race updates: own-bird migration/arrival/scoring updates and final league results.
- League race updates: every manager's migration/arrival/scoring updates.
- Own-bird updates use one event enabled by either control; final results use only My race updates, including retained legacy-category records.
- All four toggle combinations tested; durable SQLite outbox tests cover both managers' departure events without an inbox visit, with no GPS copied to inboxes.
- Mobile 390 x 844: Load older expands 10 -> 20 -> 27, disappears after the final batch, no horizontal overflow, and reopening resets to 10 and scroll position 0. Tested using a 27-event local fixture and actual inbox component, without creating live league notifications.
