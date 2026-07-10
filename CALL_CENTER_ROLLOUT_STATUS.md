# Call Center Rollout Status

Last updated: July 10, 2026

## Current position

PR [#81](https://github.com/Data-Buddies-Solutions/acuity_site/pull/81) merged
the expand migration, but its first production run failed while creating the
generation-aware ring-attempt index. Draft PR
[#83](https://github.com/Data-Buddies-Solutions/acuity_site/pull/83) contains
the data-safe recovery. No application repair has reached `main` or production.

PR [#82](https://github.com/Data-Buddies-Solutions/acuity_site/pull/82) merged
into the old migration branch rather than `main` and is superseded by the
replacement application release. Canonical `ACTIVE` routing remains rejected
by configuration, and legacy routing remains the only production
command-producing path.

## Phase status

| Phase | Scope                                                                      | Code status      | Production status                |
| ----- | -------------------------------------------------------------------------- | ---------------- | -------------------------------- |
| 0     | Automatic ringing, explicit browser readiness, replay-safe voicemail       | Complete locally | Not deployed                     |
| 1     | Durable provider inbox, retries, recovery, dead letters, retention         | Complete locally | Not deployed                     |
| 2     | Generic queues, numbers, endpoints, memberships, protected configuration   | Complete locally | Not deployed                     |
| 3     | Canonical calls, legs, tasks, events, and state-transition foundations     | Foundations only | Inactive                         |
| 4     | Canonical routing and durable command cutover                              | Not started      | Blocked by rollout gates         |
| 5     | Canonical snapshot plus ordered SSE frontend                               | Foundations only | Legacy fallback remains          |
| 6     | Delete profile routing, legacy projections, compatibility code, and tables | Not started      | Blocked until observation closes |

## Release sequence

| Release               | Contents                                                                                      | Current state                         | Exit gate                                                        |
| --------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| Expand migration      | Additive SQL migration                                                                        | PR #81 merged; production run failed  | Repaired migration receipt and schema verification               |
| Migration recovery    | Retry-safe backfill, transaction, and guarded recovery workflow                               | Draft PR #83 open                     | Production recovery succeeds and migration status is clean       |
| Application release   | Expanded Prisma schema plus shared Phase 0 ringing/readiness repair                           | Replacement draft preparing           | Ready/no-ready and transfer synthetic calls pass across profiles |
| Contract reassessment | Legacy two-column ring-attempt index cleanup                                                  | Blocked on production schema evidence | Confirm whether the legacy index exists before changing it       |
| PR C                  | Durable ingress, recovery, retention, protected configuration, inactive canonical foundations | Waiting on application release        | Recovery is healthy and backlogs are zero                        |

Do not merge these releases out of order. Do not combine the contract migration
with the expand migration.

## Validation receipt

- 233 tests passed across 30 files.
- ESLint, TypeScript, Prettier, and Prisma validation passed.
- The optimized production build passed.
- All 25 repaired migrations applied successfully to an isolated PostgreSQL 16
  database.
- The repaired migration resumed the reproduced production partial state,
  preserved duplicate attempts as distinct generations, created the new unique
  index, and completed the platform tables.
- Production duplicates prove the expected legacy two-column unique index was
  not enforcing uniqueness; verify the live schema before any contract change.

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
- Run ready-endpoint, no-ready-endpoint, transfer, duplicate-event,
  out-of-order, reconnect, and rollback synthetic tests across call-center
  profiles before `SHADOW` expansion.

Update this file after every PR merge, production migration, synthetic-call
gate, queue-mode change, rollback, or material blocker.
