# Call Center Runtime Status

Last updated: July 19, 2026

## Current contract

The portal uses one canonical call-center runtime:

- one call owns many provider-observed legs and at most one bridged winner;
- inbound offers use one fixed 20-second window, with immediate voicemail when
  no agent leg can be offered;
- the browser reads one versioned authoritative snapshot without SSE cursors;
- same-location cold transfer rings one available queue member and changes the
  winning leg only after that person answers and bridge evidence exists; warm
  transfer, wrap-up, overflow, browser call pointers, and configurable ring/wait
  policy have no runtime owner;
- provider commands dispatch inline, while one authenticated bounded outbox
  drain recovers committed commands after an interrupted request;
- provider callbacks have one receipt-to-terminal status, retry counter,
  categorical error, and recovery path;
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

Post-rollback-cleanup verification found zero retired columns, one successful
migration attempt, zero unresolved attempts, `deadlineAt`, the compatibility
`effectOwner` fence, and the Agent Session readiness constraint intact. That
established the predecessor state for the separate provider-session proof below.

## Provider-session compatibility closure

The July 19 retirement audit used aggregate production rows and sanitized
Telnyx delivery/configuration metadata:

| Check                                               |              Result |
| --------------------------------------------------- | ------------------: |
| Legacy-owned Calls                                  |                  16 |
| Nonterminal legacy-owned Calls                      |                   0 |
| Terminal legacy-owned Calls                         |                  16 |
| Unresolved legacy-owned events                      |                   0 |
| Legacy provider events                              |                 177 |
| Legacy event IDs present in Telnyx delivery history |                 177 |
| Terminal Telnyx delivery records                    |                 177 |
| Maximum observed delivery attempts                  |                   6 |
| Maximum observed delivery span                      |        14.2 seconds |
| Observation window after the last terminal delivery | 72 hours 23 minutes |

The active Telnyx credential connection used webhook API v2, had no failover
URL, and had no custom retry delay; Telnyx documents that an unset delay retries
immediately. The connection configuration predated the final legacy sessions.
The last retained legacy delivery finished at `2026-07-16T15:45:48Z`; every
retained legacy event ID had a final `delivered` or `failed` delivery record
before the 72-hour observation window closed. The provider delivery API exposes
read-only list/retrieve operations, not a replay command.

Telnyx does not publish a default Voice webhook retry ceiling. The release owner
therefore explicitly accepts the residual assumption that Telnyx will not
automatically or manually redeliver a finalized Voice webhook more than 72 hours
after its final delivery record. That assumption, together with the observed
production and provider evidence above, closes the compatibility fence and
authorizes
`20260719190000_retire_dual_webhook_lifecycle`. The migration retains historical
rows, copies the authoritative projection checkpoint into the one remaining
lifecycle, and refuses to run if a legacy call/event or active claim reopens the
gate.

## Deployment gate

Before merging, require schema validation, lint, TypeScript, the full functional
suite, the representative webhook lifecycle migration test, a clean replay of
the complete migration history, and a production build. Production migration
execution requires only `confirm=DEPLOY`. Before production verification,
configure `CRON_SECRET`. After deployment, prove inbound offer, Answer, one
bridge winner, hangup/release, no-agent voicemail, outbound dial, direct handoff,
terminal history, and outbox recovery. Compare provider-event status counts
before and after the webhook migration, and sample late callbacks for terminal
convergence.
