# Call Center Runtime Status

Last updated: July 19, 2026

## Current contract

The portal uses one canonical call-center runtime:

- one call owns many provider-observed legs and at most one bridged winner;
- inbound offers use one fixed 20-second window, with immediate voicemail when
  no agent leg can be offered;
- the browser reads one versioned authoritative snapshot without SSE cursors;
- transfer, wrap-up, overflow, browser call pointers, and configurable ring/wait
  policy have no runtime owner;
- provider commands dispatch inline, while one authenticated bounded outbox
  drain recovers committed commands after an interrupted request;
- migration `20260719180000_remove_call_center_rollback_state` removed the
  rollback-only columns from production on July 19.

## Read-only production proof

The July 19 audit found:

| Check                                     | Result |
| ----------------------------------------- | -----: |
| Agent sessions                            |    206 |
| Sessions with `offeredCallId`             |      0 |
| Sessions with `currentCallId`             |      0 |
| Queues                                    |      4 |
| Queues outside the fixed 20-second policy |      0 |
| Queues with overflow                      |      0 |
| Active calls with `queueDeadlineAt`       |      0 |
| Terminal calls with `queueDeadlineAt`     |    604 |
| Active legacy-owned calls                 |      0 |

The 604 duplicate deadlines belong only to terminal historical calls; the
migration dropped that redundant timestamp without rewriting or deleting those
calls. The audit also recorded preservation baselines of 12,841 calls, 2,044
legs, 28,696 events, 9,415 tasks, and 3,132 voicemails.

Post-migration verification found zero retired columns, one successful migration
attempt, zero unresolved attempts, both canonical Call fields
(`deadlineAt`/`effectOwner`), and the Agent Session readiness constraint intact.

## Deployment gate

Before merging, require schema validation, lint, TypeScript, the full functional
suite, a clean replay of the complete migration history, and a production build.
Production migration execution requires only `confirm=DEPLOY`. Before production
verification, configure `CRON_SECRET`. After deployment, prove inbound offer,
Answer, one bridge winner, hangup/release, no-agent voicemail, outbound dial,
direct handoff, terminal history, and outbox recovery.
