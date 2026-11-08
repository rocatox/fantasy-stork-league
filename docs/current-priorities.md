# Current app audit and priorities

Reviewed November 8, 2026, approximately 12:40 p.m. Eastern, at source revision
`a4d2130`. This is the current priority list; older dated audit entries describe
their historical state and must not be interpreted as today's backlog.

## Scope and evidence

Reviewed implementation, workflows, operational reports, retained test evidence,
and fresh read-only production health, roster, rankings, workflow logs and CPU/D1
analytics. Reran the complete `npm test` chain and production build. This is not
a new manual examination of every screen, an independent penetration test, or
a physical-device performance certification. No real leagues/accounts were
changed, no imports were forced, and no emails were sent by this audit.

- All **183 unit tests** and the complete SQLite integration chain passed,
  including permissions, archive sharding, recovery-related storage, notifications,
  mocked email, trades/swaps and the eight-manager full-season rehearsal. The
  rehearsal checked 312 race-event assertions and produced 85 mocked emails.
- The first test attempt hit a Windows sandbox temporary-directory rename denial
  in the encryption test. Rerunning with a workspace-local temporary directory
  passed the entire suite; this was not a demonstrated production encryption bug.
- Production build passed. The main browser JS remains approximately **2.10 MB
  minified / 733 KB gzip**; the chunk-size warning remains.
- `npm audit` returned zero known dependency advisories at audit time.
- Latest automatic import: [run 42503723782](https://github.com/rocatox/fantasy-stork-league/actions/runs/42503723782),
  explicitly Cloudflare-triggered, succeeded November 8 at 12:24 p.m. Eastern.
  Actual logs show eight imports (not policy skips), 36 successful histories,
  36 published statistics and successful race/capacity stages. One temporary
  history error recovered on retry. Production has 36 birds and no overdue studies.
- In-app source queue is empty; the minute email timer is idle with no pending
  player mail. Capacity sample: 0 daily attempts, 12 rolling attempts, configured
  caps 270/day and 8,100 rolling. No live race targets are established by these
  off-season checks; scoring evidence comes from isolated rehearsals.
- Storage: main **1,015,808 bytes**, archive 1 **138,862,592 bytes**, archive 2
  **40,960 bytes**. There is no immediate storage shortage. Growing months remain
  assigned to their original shard; automatic relocation is not implemented.

## Previously pending checks

### First scheduled Drive backup: verified

[Run 42499003172](https://github.com/rocatox/fantasy-stork-league/actions/runs/42499003172)
has `event=schedule`, not manual dispatch. It started at 11:15 a.m. Eastern and
completed at 11:19 a.m. Eastern on November 8. The nominal schedule was 4:38 a.m.:
GitHub delivered this run approximately 6 hours 38 minutes late.

The capture log confirms all **three databases**, local restore verification,
encrypted upload (**123,468,417 bytes**), full encrypted download/hash verification,
and retention removing one old backup. There were zero published GitHub artifacts.
The retention policy selects distinct UTC days; both the initial manual and this
scheduled capture were November 8 UTC, so retaining the newer daily snapshot and
pruning the older same-day one is consistent with that policy. A mature seven-day /
four-week rotation has not yet occurred in production; synthetic retention tests
cover it. The earlier independent local decryption/recovery drill remains valid;
this audit did not repeat personal Drive authorization or decrypt this new object.

### Full-day CPU: still pending

The current fixed window ends **November 8 at 5:39 p.m. Eastern**. At approximately
12:39 p.m., the partial 19-hour window reported 11,539 successful Worker requests,
five client disconnects, and **zero reported exceededResources outcomes**. Successful
request CPU was approximately p50 **3.77 ms**, p95 **16.13 ms**, p99 **28.35 ms**.
No failures in this partial sample does not mean all requests fit the nominal CPU
budget. These are aggregate, potentially sampled/lagging analytics across several
deployments, not endpoint-specific signed-in percentiles.

November 8 UTC D1 telemetry through this sample reported 250,441 rows read and
7,655 written. The November 7 portion is only the tail of that UTC day. No full-day
or unlimited-capacity claim is supported. The manual verifier is
`.runner/verify-production-day.mjs`; no new monitoring automation was created.

## Feature and operational status

| Area | Current status | Remaining limitation |
| --- | --- | --- |
| Leagues, six-digit invites, snake drafts, trades and swaps | Implemented; full isolated flow passes | Real race-season traffic is still ahead |
| Arrivals, ties, nonfinishers, recovered birds and corrections | Implemented; full-season tests pass | No live season was simulated against real leagues |
| Scouting, profiles, histories, lists and settings | Implemented; caches and current map alignment tested | Stars are browser-local and not account-scoped; lists/preferences sync |
| Migration-start detection | Historical replay and server evidence checks implemented | No independent departure labels; missed/delayed signals remain intentional |
| In-app and Brevo email | Durable capture, category settings, no self-action duplicates, retries and unsubscribe tested | Free sending budget can delay/expire large bursts; no batching by user choice |
| Archive storage | Lossless compression, protected resolution, older sampling and two archive shards deployed | More capacity does not increase shared query/write quotas |
| Backups and recovery | Encrypted off-device backup plus local/hosted/failover drills completed | GitHub timing is best effort; secrets and Clerk identity data are not in backup |
| Operational alerts | Backup/sync/capacity/backlog checks deployed | Watchdog depends on the same Worker, D1 and mail provider |
| Security | Recent permissions/body limits/invite throttling/security headers; suites pass | Full CSP compatibility, account deletion lifecycle and independent review remain |
| Desktop accessibility | Automated browser/forced-colors work done; resilience fixes retained | New keyboard/focus behavior was rolled back after Zen freezing; earlier focus-test claims are historical |
| PWA | Manifest, icons, service worker and offline fallback implemented | Full physical installation/update/offline matrix deferred; mobile remains secondary |
| Clerk profile management | Existing production sign-in works; styling reviewed | Isolated real username/photo save verification was paused by the user |

## Recommended priority order

1. **Close the reliability observation window.** Run the full-day verifier after
   5:39 p.m. Eastern, allow telemetry lag, inspect failure timestamps and deployment
   changes, and obtain targeted signed-in CPU traces only if needed. Preserve the
   focus rollback. Obtain the user's Zen trackpad verdict separately from alignment
   tests. Acceptance: clearly attributed results, no unexplained resource failures,
   and an explicit decision about any remaining cold-request spikes.
2. **Automatic regression checks — completed November 8.** `checks.yml` runs
   unit/integration tests, production build and runner bundles, plus 61 isolated
   UI checks in each of Chromium and Firefox. No production secrets, real email,
   imports or deployments are involved. The first push-triggered run
   [42506769078](https://github.com/rocatox/fantasy-stork-league/actions/runs/42506769078)
   passed all three jobs at implementation revision `97da544`: 183 unit tests,
   the complete integration chain, builds and both browser suites, with zero
   browser errors. Keyboard/focus rollback checks remain. Main-branch protection now requires pull requests and all three GitHub Actions
   checks against an up-to-date base, including for administrators. Force pushes
   and branch deletion are disabled. Manual Cloudflare deployment remains a
   separate operation and should use tested commits merged into main.
3. **Define account privacy and deletion end to end.** Account management delegates
   to Clerk, but no application account-deletion/webhook cleanup path was found.
   Decide how to remove private lists, preferences, reports and notification/mail
   state while preserving anonymized historical league results and resolving host
   ownership. Provide a player-facing data-use/retention page; the existing public
   privacy page describes the operator's backup tool only. Verify with isolated
   accounts, never by deleting the real account. This is a product/data-lifecycle
   gap, not a finding that another user can access private data.
4. **Finish measurable desktop performance work.** Confirm Zen behavior, then profile
   realistic dense routes and page return. Split the large initial bundle and load
   optional screens/data only when required if measurements justify it. Keep marker/
   trail alignment, independent translucent overlaps and reduced-motion behavior.
   Do not reintroduce keyboard/focus changes as part of a rendering optimization.
5. **Plan for email growth before expanding participation.** Keep individual emails
   and current preferences. Test queue priority/expiry and make delayed delivery
   operationally visible; consider configurable volume controls only with approval.
   The prior 50-overlapping-league fixture still generated 3,200 emails against a
   270/day app budget. Processing faster cannot remove the daily sending ceiling.
6. **Expand the approved bird pool.** Review the replies/access grants to the already
   sent Fiedler/Flack requests, then validate reuse permissions and per-bird eligibility,
   identities, historical coverage and storage before adding sources. Automatic
   discovery currently covers the eight approved studies, not arbitrary new studies.
7. **Finish bounded secondary validation.** Real isolated Clerk username/photo saves;
   optional manual screen-reader and Windows contrast checks; desktop PWA install,
   update and offline recovery. Keep mobile physical checks secondary as requested.
8. **Optional product refinements.** Account-based stars (separate from lists), further
   onboarding polish and richer scouting statistics. Push, native apps and Animal
   Tracker photos remain deferred; no reason to prioritize them over reliability.

## What not to redo or deploy now

Migration/old-app retirement, race engine, full-season rehearsal, archive sharding,
Brevo cutover, automatic backups and operational alerts are completed work, not
unstarted projects. There are no identified pending schema migrations in the
reviewed release record. Do not redeploy or force production imports merely to
refresh this audit. Retain existing free plans, no email batching, private backups,
and the keyboard/focus rollback.
