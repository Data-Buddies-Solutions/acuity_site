# Call Center Rollout Status

Last updated: July 10, 2026

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

Legacy routing and projections remain authoritative. The durable provider
inbox, generic database routing, canonical call model, and revisioned frontend
stream are schema or design foundations only.

## Phase status

| Phase | Scope                                                                    | Code status                         | Production status                  |
| ----- | ------------------------------------------------------------------------ | ----------------------------------- | ---------------------------------- |
| 0     | Ringing, readiness, trusted ingress, voicemail safety, Live Queue Take   | Merged in #84, #86, and #87         | Deployed; coordination gate failed |
| 1     | Durable provider inbox, retries, recovery, dead letters, retention       | Schema only                         | Processing inactive                |
| 2     | Generic queues, numbers, endpoints, memberships, protected configuration | Schema only                         | Legacy configuration remains owner |
| 3     | Canonical calls, legs, tasks, events, and state-transition foundations   | Schema only                         | Inactive                           |
| 4A    | Canonical routing and durable command foundations                        | Not started                         | Blocked by Phases 1-3              |
| 5A    | Canonical snapshot, ordered SSE, reducer, and media adapter              | Legacy UI repaired only             | Route-refresh stream remains       |
| 4B/5B | Per-queue routing and frontend cutover                                   | Not started                         | Must activate together             |
| 6A/6B | Delete legacy application code, then drop legacy schema                  | Not started                         | Blocked until observation closes   |
| 7     | API-mediated direct SIP handoff from trusted voice agents                | Specified and deliberately deferred | Public-number handoff remains      |

## Release sequence

| Release                  | Contents                                                     | Current state                   | Exit gate                                              |
| ------------------------ | ------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------ |
| Expand migration         | Additive Phase 1-3 schema                                    | PR #81 merged                   | Closed by migration recovery                           |
| Migration recovery       | Retry-safe backfill and guarded recovery workflow            | PR #83 merged; production clean | Complete                                               |
| Shared ringing/readiness | Automatic station ringing and explicit readiness             | PR #84 merged and deployed      | Included in current observation gate                   |
| Trusted ingress          | Keep internal station legs out of the patient queue          | PR #86 merged and deployed      | Cross-profile synthetic call gate                      |
| Live Queue ownership     | One pre-answer UI and station-leg reuse                      | PR #87 merged and deployed      | Coordination gate failed on duplicate Take burst       |
| Canonical foundations    | Durable ingress, generic routing, canonical calls            | Not started                     | Complete Phases 1-3                                    |
| Coordinated call control | Idempotent commands, ordered SSE, reducer, and media adapter | Not started                     | Build 4A/5A, then activate 4B/5B together per queue    |
| Direct SIP handoff       | API claim plus short-lived queue-bound SIP transfer          | Phase 7 specified; deferred     | Phases 0-6 complete and provider contract tests proven |

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

## Proposed defaults and production gates

- Confirm the current 20-second ring timeout and 30-second maximum wait for the
  first call-center rollout.
- Confirm optional wrap-up during migration.
- Confirm provider-hosted voicemail behind the authorized proxy during
  migration.
- Set and approve `CALL_CENTER_WEBHOOK_RETENTION_DAYS` before durable ingress.
- Set a strong `CRON_SECRET` before enabling the recovery schedule.
- Keep one active browser per provider credential until canonical endpoint
  leasing is proven under concurrent check-in.
- Require zero dead letters, ambiguous commands, and stale unconfirmed commands
  before widening rollout.
- Treat duplicate Take, transfer, concurrent-tab, remount, and reconnect tests
  as hard gates for the coordinated 4B/5B cutover.
- Run no-ready-endpoint voicemail and ring-timeout recovery.
- Run transfer ringing and Take from the target seat.
- Run duplicate-event, out-of-order, reconnect, and rollback tests across
  call-center profiles before `SHADOW` expansion.
- Do not begin Phase 7 direct SIP work until Phases 1-6 are active, legacy
  routing is deleted, and LiveKit/Telnyx transfer-failure semantics are covered
  by provider contract tests.

Update this file after every PR merge, production migration, synthetic-call
gate, queue-mode change, rollback, or material blocker.
