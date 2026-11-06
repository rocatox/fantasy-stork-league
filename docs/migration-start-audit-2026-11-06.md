# Migration-start detector audit — 2026-11-06

Status: original investigation recorded below. The user subsequently authorized implementation of the stopover-tolerant, 300 km candidate as version 2; its production implementation and verification are documented in migration-start-notifications.md.

## Main finding

Requiring three consecutive travel days excludes many plausible migrations with stopovers. The strongest tested candidate keeps five stable baseline days, three >=60 km daily movements, paired daily observations, continuous same-tag coverage, direction/straightness checks, an extra confirmation day and the pre-arrival cutoff. It allows the three travel days to occur within a maximum of five days and strengthens net displacement from 200 to **300 km**, including at confirmation.

| Rule | Signals / 166 seasons | With later confirmed spring arrival | New vs v1 | Returns near baseline within 7 days |
|---|---:|---:|---:|---:|
| Current v1 | 53 | 48 | 0 | 1 |
| Allow stopovers only | 93 | 84 | 40 | 1 |
| Allow stopovers + require 300 km | **90** | **83** | **38** | **0** |
| Shorten baseline to 3 days only | 76 | 69 | 23 | 1 |
| Allow 2 substantial travel days only | 91 | 83 | 38 | 1 |

The 90-signal candidate retains 52 original detections, adds 38, and rejects one suspect original detection (Olli, 2020). The rule is still conservative; it does not turn absent evidence into proof of migration.

## Why 166 was not a recall denominator

The recovery archive contains 166 January–June bird-seasons from 30 birds, including incomplete years. Twenty begin with a location already inside Germany, at their first recorded arrival. There is no preceding observed departure to detect in those records. Of the remaining 146, 132 have a corroborated spring arrival; arrival alone does not prove the archive captured the beginning of migration. Coverage and departure labels remain incomplete.

For the 113 v1 nondetections, the first gate no candidate window could pass was:
- 20: first recorded location already inside Germany (classified separately).
- 62: three consecutive >=60 km travel legs.
- 10: no complete candidate before arrival / within the race window.
- 8: insufficient continuous paired daily coverage.
- 5: net displacement / straightness.
- 6: progress toward Germany.
- 2: stable baseline.

These are ordered gate diagnostics, not independent causes: a season can have multiple limitations.

## Safety checks

- Of the 38 additional signals, 36 have a subsequent confirmed German arrival. Frensdorf I-2 (2025) and Hamburg 8 (2026) do not have one in the available spring records; they remain plausible departures, not confirmed race finishes.
- No new signal returns within 50 km of its baseline in the subsequent 30 days of available paired daily observations. Every addition has at least five such follow-up days in the first week. This is a diagnostic for excursions, not proof of migration or a continuous-location guarantee.
- Olli's 2020 v1 alert would confirm on February 1 after roughly 247 km net movement, followed by a return near baseline within a week. Its eventual German arrival on April 17 does not validate that early departure signal. The 300 km candidate excludes it.
- Raw-observation prefix replay passed for all **90** proposed detections: each is available using observations only up to its confirmation time, and not yet available immediately before its final confirming fix. This checks the decision time rather than relying only on full-season hindsight. It does not exhaustively replay every earlier observation or supply independent biological labels.
- Synthetic commuting, local wandering, isolated spikes, stationary jumps, southbound travel and immediate returns produce no alerts under the recommended candidate.
- A two-travel-day shortcut was rejected: it alerts prematurely on the immediate-return control.
- A sustained long excursion that returns only after confirmation remains intrinsically ambiguous to an online detector. The delayed-return control demonstrates this limitation for both v1 and the recommended candidate.
- Improvement spans older and recent data: pre-2025 counts rise 36 -> 51; 2025–2026 counts rise 17 -> 39. This is a descriptive split, not an independent held-out validation set: variants were explored using the full corpus.

## Examples recovered by the recommended candidate

All dates below are UTC dates. “First moved anchor” is an observed daily position, not an exact inferred biological departure date.

| Bird / year | First moved anchor | Alert confirmation | German arrival |
|---|---|---|---|
| Kiki 2026 | Feb 24 | Mar 1 | Mar 4 |
| Frensdorf I-3 2026 | Mar 8 | Mar 13 | Mar 19 |
| Mogli 2026 | Feb 15 | Feb 20 | Feb 26 |
| Sissi 2026 | Feb 22 | Feb 27 | Mar 13 |
| Zeus 2026 | Feb 13 | Feb 18 | Mar 3 |

## Recommendation and limits

Adopt the stopover-tolerant, 300 km candidate as version 2 after implementing its variable-length evidence validation and regression tests. Keep the five-day baseline, three substantial travel days and existing gap/outlier safeguards. Do not adopt the two-day shortcut or relax tracking gaps on this evidence.

No independently labeled migration starts exist in this archive. Subsequent arrival and absence of a return are supporting evidence, not ground truth. The investigation found no additional suspicious returns for the recommended candidate, but cannot establish a zero false-positive rate. Alerts should continue to say “Migration detected” and identify the result as an estimate. Arrival scoring and migration statistics do not change.

## Reproduction / data handling

Read-only input: local `main-history-restore.sqlite` and `archive-history-restore.sqlite`, snapshot 2026-10-27. Shared GPS-quality and corroborated arrival checks are used. The audit exactly reproduces the 53 baseline detections before comparison. Local work scripts: `migration-audit-extract.mjs`, `migration-audit-candidates.mjs`, `migration-audit-compare.mjs`, `migration-audit-controls.mjs`, `migration-audit-followup.mjs`, and `migration-audit-prefixes.mjs`. Per-bird anchors and raw GPS remain in the local work directory; no GPS evidence was uploaded to GitHub or workflow artifacts. No live league or notification records were created or changed.
