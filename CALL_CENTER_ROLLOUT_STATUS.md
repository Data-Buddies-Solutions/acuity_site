# Call Center Rollout Status

Last updated: July 10, 2026

## Current position

The complete implementation tranche is validated locally. Production rollout
has not started. Canonical `ACTIVE` routing remains rejected by configuration,
and legacy routing remains the only production command-producing path.

The current release step is **PR A: expand migration**. Draft PR
[#81](https://github.com/Data-Buddies-Solutions/acuity_site/pull/81) is open.
PR B is being prepared as a stacked draft for review, but it must not merge
until PR A is merged and the production migration is verified.

## Phase status

| Phase | Scope | Code status | Production status |
| --- | --- | --- | --- |
| 0 | Automatic ringing, explicit browser readiness, replay-safe voicemail | Complete locally | Not deployed |
| 1 | Durable provider inbox, retries, recovery, dead letters, retention | Complete locally | Not deployed |
| 2 | Generic queues, numbers, endpoints, memberships, protected configuration | Complete locally | Not deployed |
| 3 | Canonical calls, legs, tasks, events, and state-transition foundations | Foundations only | Inactive |
| 4 | Canonical routing and durable command cutover | Not started | Blocked by rollout gates |
| 5 | Canonical snapshot plus ordered SSE frontend | Foundations only | Legacy fallback remains |
| 6 | Delete profile routing, legacy projections, compatibility code, and tables | Not started | Blocked until observation closes |

## Release sequence

| Release | Contents | Current state | Exit gate |
| --- | --- | --- | --- |
| PR A | Expand-only SQL migration | Draft PR #81 open | Production migration receipt and schema verification |
| PR B | Expanded Prisma schema plus Phase 0 repair | Stacked draft preparing | Optical ready/no-ready synthetic calls pass |
| Contract PR | Drop the legacy two-column ring-attempt unique index | Waiting on old-instance drain | New generation index remains and retry call passes |
| PR C | Durable ingress, recovery, retention, protected configuration, inactive canonical foundations | Waiting on PR B and governance | Recovery is healthy and backlogs are zero |

Do not merge these releases out of order. Do not combine the contract migration
with the expand migration.

## Validation receipt

- 233 tests passed across 30 files.
- ESLint, TypeScript, Prettier, and Prisma validation passed.
- The optimized production build passed.
- All 24 migrations applied successfully to an isolated PostgreSQL 16 database.
- The expand migration retains the legacy ring-attempt unique index while adding
  the generation-aware unique index.

## Proposed defaults and production gates

- Confirm the current 20-second ring timeout and 30-second maximum wait for the
  first optical rollout.
- Confirm optional wrap-up during migration.
- Confirm provider-hosted voicemail behind the authorized proxy during
  migration.
- Set and approve `CALL_CENTER_WEBHOOK_RETENTION_DAYS` before durable ingress.
- Set a strong `CRON_SECRET` before enabling the recovery schedule.
- Keep one active browser per provider credential until canonical endpoint
  leasing is proven under concurrent check-in.
- Require zero dead letters, ambiguous commands, and stale unconfirmed commands
  before widening rollout.
- Run optical ready-endpoint, no-ready-endpoint, duplicate-event, out-of-order,
  reconnect, and rollback synthetic tests before `SHADOW` expansion.

Update this file after every PR merge, production migration, synthetic-call
gate, queue-mode change, rollback, or material blocker.
