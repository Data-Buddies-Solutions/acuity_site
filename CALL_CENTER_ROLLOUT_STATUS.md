# Call Center Rollout Status

Last updated: July 12, 2026

## Current position

PR [#83](https://github.com/Data-Buddies-Solutions/acuity_site/pull/83) repaired
the partially applied PR #81 migration. Production migration state is clean and
the additive Phase 1-3 tables exist.

PR [#84](https://github.com/Data-Buddies-Solutions/acuity_site/pull/84) deployed
shared automatic ringing and explicit browser readiness. PR
[#85](https://github.com/Data-Buddies-Solutions/acuity_site/pull/85) attempted
to keep the internal browser station leg out of the patient queue, but its
SIP-name heuristic did not match the production provider payload. PR
[#86](https://github.com/Data-Buddies-Solutions/acuity_site/pull/86) superseded
that heuristic with trusted-ingress classification.

The first production sequence observed after PR #86 answered and bridged the
intended station leg and ended normally without the earlier duplicate
queue-entry and 422 sequence. This is one positive call receipt, not the full
synthetic-call gate.

PR [#87](https://github.com/Data-Buddies-Solutions/acuity_site/pull/87) is merged,
all GitHub and Vercel checks passed, and its production deployment is Ready. It
makes Live Queue the only pre-answer UI for ordinary calls and transfers,
keeps Softphone as the WebRTC/connected-call owner, and makes Take reuse an
existing station leg.

Post-#87 production evidence exposed the remaining coordination failure. One
Take sequence issued five requests in about one second: the first returned
`200`, followed by four `502` uniqueness failures. Other bursts returned `200`
followed by stale `404` or `502` responses. Successfully processed calls still
bridged once and ended normally. Legacy Take is therefore not command-idempotent,
and browser media state plus route refresh remain competing UI owners.

PR [#88](https://github.com/Data-Buddies-Solutions/acuity_site/pull/88) merged
the coordinated cutover and direct-SIP documentation without changing a runtime
owner. PR [#89](https://github.com/Data-Buddies-Solutions/acuity_site/pull/89)
made legacy Take replay-safe. Its checks passed, but the normal-call, transfer,
remount, and reconnect production receipts are still required before the
coordination gate closes.

PR [#90](https://github.com/Data-Buddies-Solutions/acuity_site/pull/90) merged
durable inbox processing, bounded recovery, and payload retention. Durable
ingress is enabled in production and the authenticated recovery cron returns
`200`; the first live webhook backlog receipt is still pending. Legacy
processing remains authoritative.

PR [#91](https://github.com/Data-Buddies-Solutions/acuity_site/pull/91) merged
Phase 2A as an admin-only, redacted configuration report. It makes no writes and
preserves each legacy seat ID as the proposed endpoint ID.

The production Abita report exposed one location-scoped legacy queue with
endpoints but no profile-derived member. The next Phase 2A refinement reads
only current practice members already observed on those legacy seats, so the
report can preserve proven access without inferring a user from a name or
email. The report remains read-only and blocked when no such evidence exists.

PR [#92](https://github.com/Data-Buddies-Solutions/acuity_site/pull/92) added the
independent passive-projection checkpoint and its production migration is
applied. PR [#93](https://github.com/Data-Buddies-Solutions/acuity_site/pull/93)
merged the admin-only, ETag-protected generic configuration snapshot. PR
[#94](https://github.com/Data-Buddies-Solutions/acuity_site/pull/94) merged the
pure revision, reset, snapshot, and reducer contracts. PR
[#95](https://github.com/Data-Buddies-Solutions/acuity_site/pull/95) merged
canonical endpoint leasing with stale-readiness rejection and canonical
client-instance identity. None of these PRs changes the live routing or
frontend owner.

After the seat-usage evidence was deployed, the Abita report reached zero
ambiguities: three queues, two numbers, nine endpoints, and five observed
current members on the previously unmapped queue. PR
[#100](https://github.com/Data-Buddies-Solutions/acuity_site/pull/100) merged the
guarded, report-version-pinned bootstrap. Production run `29184000699` created
three `LEGACY` queues, two numbers, nine endpoints, and seven memberships. It
changed no routing or frontend owner.

PR [#99](https://github.com/Data-Buddies-Solutions/acuity_site/pull/99) merged a
transactionally consistent,
queue-authorized canonical snapshot and an explicit
`contract=canonical&queueId=...` event stream. The existing refresh stream
remains the default. The canonical stream uses decimal revision strings,
supports resume and reset semantics, emits only projection-derived deltas, and
closes after a bounded invocation window. It has no frontend wiring.

PRs [#103](https://github.com/Data-Buddies-Solutions/acuity_site/pull/103) and
[#111](https://github.com/Data-Buddies-Solutions/acuity_site/pull/111) are merged
to `main`. PR #111 cleanly integrated the already reviewed #105-#110 stack
after GitHub had merged each child only into its feature-branch parent. The
cumulative code provides shadow recovery, default-off durable commands,
canonical realtime ownership, the shadow shell, manual claim, and immediate
post-commit dispatch. It keeps `LEGACY` as the only live provider-effect and
frontend owner.

PR [#108](https://github.com/Data-Buddies-Solutions/acuity_site/pull/108), now
integrated by #111, wires the portal to exactly one server-authorized `SHADOW`
queue. It claims a
per-tab client identity, mirrors legacy station readiness into a
credential-free canonical endpoint lease, and runs one snapshot/SSE reducer.
Its output is aggregate diagnostics only; it adds no ringtone, media, call
action, or provider command. This is the observation shell, not the cutover.

PR [#109](https://github.com/Data-Buddies-Solutions/acuity_site/pull/109), now
integrated by #111, adds
the first canonical user action: one authenticated, idempotent Take produces
one reserved agent session, agent leg, durable `DIAL_AGENT` command, operation
receipt, and snapshot/SSE status. It revalidates ownership before dispatch and
releases reservations on terminal or losing-leg outcomes. Local validation
passes 472 tests, and CI plus the Vercel preview are green. It has no migration
or environment-variable change. `ACTIVE` remains rejected and dispatch remains
disabled, so this PR cannot affect calls.

PR [#110](https://github.com/Data-Buddies-Solutions/acuity_site/pull/110), now
integrated by #111,
wakes a committed pending claim command through Next.js `after()` and shares
one dispatcher composition with the recovery cron. Provider I/O remains outside
the claim transaction and response, pending replays safely re-wake the same
durable row, and any scheduling or callback failure leaves cron recovery intact.
Local validation passes 476 tests and the production build. It has no migration
or environment-variable change, and all production effect gates remain closed.

PR #112 added the immutable `effectOwner` schema, and production migration run
`29203472713` applied it successfully. PR #113 then made the owner durable before
either provider-effect lane runs. Every Telnyx event records the provider
session and owner; configured inbound calls record the same owner on the call.
Later callbacks cannot switch owners during activation or rollback. Both PRs
are merged and deployed; `ACTIVE` remains rejected until the generic Phase
4B/5B implementation is complete.

PR #114 added nullable active-call deadlines, durable command dependencies, and
the indexed recovery scan. It merged before the application slice, and
Production Migrations run `29205313102` applied it successfully on July 12, 2026. The application-ahead-of-database risk is closed.

The active-routing application branch now implements the generic Phase 4B/5B
cutover for every enabled queue and configured number: immutable admission,
ordered commands, first-agent winner and loser cleanup, overflow/voicemail,
transfer, outbound, disposition and task handling, exact session-bound media,
multi-queue selection, reconnect/remount, mixed canonical/legacy observation
reads, automated preflight, and rollback drainage. It remains default-off and
is not production-authoritative until the final repository validation, PR merge,
deployment, preflight, and controlled per-number calls complete.

Legacy routing and projections remain authoritative. Phase 3B has an independent
passive projector recovery lane; canonical writes and checkpoint completion are
transactional, and it cannot issue provider commands or write legacy
projections. After the reviewed configuration replay passed, production enabled
`CALL_CENTER_CANONICAL_PROJECTION_ENABLED` and redeployed as
`acuity-health-3196tqbxd`. Observation and comparison evidence remain pending.
PR #104 added a permanent aggregate recovery report. It remains an optional
diagnostic surface, not an activation gate. Production run
`29191111693` found zero durable inbox rows, zero canonical projection rows,
zero commands, zero canonical calls, and zero shadow decisions. This proves no
backlog or failed work exists, but a real or dedicated synthetic event is still
required to prove the live projection path.

PR [#97](https://github.com/Data-Buddies-Solutions/acuity_site/pull/97) merged
an isolated post-response canonical attempt, keeps cron as recovery, binds
later callbacks through exact provider leg identity, monotonically enriches
earlier/richer facts, and reconciles handled outcomes from persisted bridge and
voicemail evidence rather than delivery order.

The Phase 5A media-adapter extraction keeps the legacy panel and queue behavior
unchanged while moving Telnyx client objects, media preparation, remote audio,
and call controls behind `useSoftphoneMedia`. Its canonical observations bind by
connection and provider/media-leg IDs; the temporary caller-phone fallback stays
only in the legacy panel until the coordinated frontend cutover.

The first intentional no-op replay, run `29184046620`, exposed that raw legacy
text was hashed before the protected save normalized it. PR #101 aligned that
normalization, but run `29184305911` still stopped safely. Protected diagnostic
run `29184443612` then proved the candidate and persisted configuration had no
value differences while their hashes differed. PR #102 made configuration
identity independent of object insertion order. Production replay `29184635301`
then returned `changed: false` with three `LEGACY` queues, two numbers, nine
endpoints, and seven memberships.

## Phase status

| Phase | Scope                                                                    | Code status                             | Production status                     |
| ----- | ------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------- |
| 0     | Ringing, readiness, trusted ingress, voicemail safety, Live Queue Take   | Merged in #84, #86, #87, and #89        | #89 synthetic gate pending            |
| 1     | Durable provider inbox, retries, recovery, dead letters, retention       | #90/#104 merged and deployed            | Empty backlog; live proof pending     |
| 2     | Generic queues, numbers, endpoints, memberships, protected configuration | PRs #91, #93, #95, #100-#102 merged     | Bootstrap applied and replay verified |
| 3     | Canonical calls, legs, tasks, events, and state-transition foundations   | #92 checkpoint and #97 projector merged | Enabled; no live events observed yet  |
| 4A    | Canonical routing, commands, and immutable effect ownership              | #103/#111-#113 merged                   | No commands; all queues stay LEGACY   |
| 5A    | Canonical snapshot, ordered SSE, reducer, and media adapter              | #111 merged                             | Legacy UI remains authoritative       |
| 4B/5B | Global routing and frontend cutover for all configured numbers           | Implementation complete; final PR gate  | Deploy off; preflight; activate once  |
| 6A/6B | Delete legacy application code, then drop legacy schema                  | Not started                             | Blocked until observation closes      |
| 7     | API-mediated direct SIP handoff from trusted voice agents                | Specified and deliberately deferred     | Public-number handoff remains         |

## Release sequence

| Release                  | Contents                                                     | Current state                   | Exit gate                                                         |
| ------------------------ | ------------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------- |
| Expand migration         | Additive Phase 1-3 schema                                    | PR #81 merged                   | Closed by migration recovery                                      |
| Migration recovery       | Retry-safe backfill and guarded recovery workflow            | PR #83 merged; production clean | Complete                                                          |
| Shared ringing/readiness | Automatic station ringing and explicit readiness             | PR #84 merged and deployed      | Included in current observation gate                              |
| Trusted ingress          | Keep internal station legs out of the patient queue          | PR #86 merged and deployed      | Cross-profile synthetic call gate                                 |
| Live Queue ownership     | One pre-answer UI and station-leg reuse                      | PR #87 merged and deployed      | Coordination gate failed on duplicate Take burst                  |
| Take replay safety       | Reuse the owned live attempt and type losing/terminal races  | PR #89 merged                   | Normal, transfer, remount, and reconnect gates                    |
| Durable ingress          | Inbox, retry recovery, retention, and authenticated schedule | #90/#104 merged and deployed    | Empty aggregate report; live receipt pending                      |
| Canonical foundations    | Generic configuration and passive canonical calls            | #91-#93, #95, #97, #100-#102    | Enabled passively; observation gate remains                       |
| Coordinated call control | Commands, SSE, reducer, media adapter, and effect ownership  | #103/#111-#113 merged to `main` | Build active operations/media/actions for every configured number |
| Direct SIP handoff       | API claim plus short-lived queue-bound SIP transfer          | Phase 7 specified; deferred     | Phases 0-6 complete and provider contract tests proven            |

## Validation receipt

- PR #87 passed Prisma, format, lint, typecheck, test, build, and Vercel checks.
- The local PR #87 receipt was 155 passing tests across 19 files.
- The optimized production build passed and the current production deployment
  is Ready.
- All 25 repaired migrations applied successfully to an isolated PostgreSQL 16
  database.
- The repaired migration resumed the reproduced production partial state,
  preserved duplicate attempts as distinct generations, created the new unique
  index, and completed the platform tables.
- Production duplicates prove the expected legacy two-column unique index was
  not enforcing uniqueness; verify the live schema before any contract change.
- One post-#86 production call answered, bridged, and ended normally without a
  duplicate queue entry.
- Post-#87 logs showed one successful Take followed by concurrent duplicate
  `502` failures, plus other successful requests followed by stale `404` or
  `502` responses. Successful call records still showed one bridge and normal
  completion.
- PR #89 passed CI, build, and Vercel checks, including 54 focused call-center
  tests. Production duplicate-Take synthetics remain required.
- PR #90 passed Prisma, format, lint, typecheck, 197 tests, the production
  build, and its Vercel preview. Production activation gates remain open.
- PR #91 passed local Prisma, format, lint, typecheck, 170 tests, and a
  production build. It has no migration or runtime activation and is merged.
- PR #93 passed local Prisma, format, lint, typecheck, 245 tests, and a
  production build. It has no migration and leaves legacy routing authoritative.
- PR #97 passed Prisma validation, lint, typecheck, 319 tests,
  changed-file formatting, and the optimized production build. It adds no
  migration and remains disabled by default.
- The Phase 5A snapshot/SSE branch passes full CI with 308 tests and a
  production build. It has no migration and leaves the legacy event
  stream and frontend ownership unchanged.
- PRs #103-#108 have green Prisma, format, lint, typecheck, test, build, and
  Vercel checks. PR #109 passes 472 tests locally, focused and
  full typecheck/lint/format validation, Prisma validation, and the optimized
  production build. It has no migration or environment-variable change.
- PR #110 passes 476 tests locally, typecheck, lint, formatting, Prisma
  validation, and the optimized production build. It has no migration or
  environment-variable change.
- PR #111 integrated #105-#110 directly into `main`; local validation and every
  GitHub/Vercel check passed with 476 tests and the production build.
- The immutable ownership slice passes Prisma validation, changed-file lint and
  formatting, typecheck, 492 tests, and the production build. Its additive
  migration backfills historical inbox rows and Telnyx session IDs, defaults
  rollback-era inserts to `LEGACY`, adds the call owner, and lets new code write
  event ownership as null until ingress resolves it before effects.

## Next full-system test gate

The remaining finish line is:

1. pass full typecheck, lint, tests, formatting, Prisma validation, production
   build, and final ACTIVE invariant review;
2. merge the complete application refactor to `main` and deploy it default-off;
3. run one automated preflight that verifies migration state, complete enabled
   configuration, current endpoint readiness, callback ownership, and zero
   unhealthy command/event counts;
4. activate canonical routing and frontend ownership together for all
   configured queues and phone numbers through one global switch;
5. run controlled calls to every number, including duplicate clicks,
   concurrent tabs, reconnect/remount, no-ready-endpoint voicemail, transfer,
   callback correlation, and global rollback.

The aggregate recovery report and `SHADOW` remain optional diagnostic tools;
neither is a separate release gate. Legacy deletion and direct SIP handoff
happen after the global observation window.

## Proposed defaults and production gates

- Confirm the current 20-second ring timeout and 30-second maximum wait for the
  first call-center rollout.
- Confirm optional wrap-up during migration.
- Confirm provider-hosted voicemail behind the authorized proxy during
  migration.
- Set a strong `CRON_SECRET`, approve payload retention, and set
  `CALL_CENTER_WEBHOOK_RETENTION_DAYS` before deploying PR #90.
- Deploy first with `CALL_CENTER_DURABLE_WEBHOOK_INGRESS_ENABLED=false`, verify
  the authorized recovery route, then enable durable ingress and redeploy.
- Keep one active browser per provider credential until canonical endpoint
  leasing is proven under concurrent check-in.
- Make activation run one automated preflight and fail closed on dead letters,
  ambiguous commands, stale unconfirmed commands, incomplete configuration, or
  an unapplied migration.
- Treat duplicate Take, transfer, concurrent-tab, remount, and reconnect tests
  as hard gates for the coordinated 4B/5B cutover.
- Run no-ready-endpoint voicemail and ring-timeout recovery.
- Run transfer ringing and Take from the target seat.
- Run duplicate-event, out-of-order, reconnect, and global rollback tests across
  every configured phone number immediately after activation.
- Do not begin Phase 7 direct SIP work until Phases 1-6 are active, legacy
  routing is deleted, and LiveKit/Telnyx transfer-failure semantics are covered
  by provider contract tests.

Update this file after every PR merge, production migration, synthetic-call
gate, queue-mode change, rollback, or material blocker.
