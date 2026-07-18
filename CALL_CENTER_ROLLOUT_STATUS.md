# Call Center Redesign Status

Last updated: July 15, 2026

## Current position

The production call center is already using canonical inbound, outbound,
user-owned browser endpoints, internal transfer, ordered realtime state, and
direct SIP handoff. The remaining cleanup is implemented on branch
`codex/call-center-canonical-cleanup` and is not production until its PR merges
to `main`, its migration runs, and `main` deploys.

This cleanup replaces the phased rollout structure with one production
contract:

- configured enabled queues and numbers are canonical immediately;
- queue `LEGACY / SHADOW / ACTIVE` modes are removed;
- activation preflight, global activation/rollback configuration, migration
  reports, bootstrap scripts, recovery reports, and the shadow UI are removed;
- the station selector and legacy softphone/workspace APIs are removed;
- the portal, history, follow-up, caller thread, voicemail playback, and actions
  read and write canonical calls/tasks only;
- legacy sessions, queue items, ring attempts, seats, presence, missed calls,
  notes, and profile branches are deleted after their history is migrated.

## Data proof

The cleanup migration passes from an empty database and from a seeded legacy
database containing duplicate session legs, duplicate recordings, a missed
call, a linked note, and a note with no direct source row. The seeded result is
2 calls, 2 voicemail recordings, and 5 canonical tasks/events with no lost row.

The July 15 production read-only audit found:

| Check                                           | Result |
| ----------------------------------------------- | -----: |
| Legacy sessions                                 | 14,641 |
| Missed calls                                    |  4,846 |
| Voicemail recordings                            |  2,980 |
| Notes                                           |    946 |
| Orphan notes                                    |     21 |
| Orphan notes with deterministic call mapping    |     21 |
| Missed calls without a session                  |      0 |
| Voicemails without a session or canonical call  |      0 |
| Session-owning practices without a phone number |      0 |
| Maximum recordings sharing one legacy source    |      2 |

The migration explicitly preserves the duplicate recording case and fails
closed if any historical row cannot be mapped.

## Verification receipt

- Prisma schema validation: pass.
- TypeScript: pass.
- Functional suite: 582 passed, 1 PostgreSQL concurrency test intentionally
  skipped without its dedicated test database.
- Empty-database migration: pass.
- Seeded legacy migration: pass.
- Production history mapping audit: pass, read-only.
- Full repository lint: pass.
- Full production build: pass.
- Final CI-equivalent rerun: pass.

## Remaining gate

Open one PR to `main`, merge it, run the production migration workflow, deploy
`main`, and execute the controlled inbound, outbound, reconnect, voicemail,
transfer, and direct-handoff checks in the deployment runbook.
