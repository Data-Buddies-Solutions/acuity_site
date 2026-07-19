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
- old database columns and enum values remain physically intact for deployment
  rollback, but the canonical runtime does not read or write them.

## Read-only production proof

The July 19 audit found:

| Check                                     | Result |
| ----------------------------------------- | -----: |
| Agent sessions                            |    195 |
| Sessions with `offeredCallId`             |      0 |
| Sessions with `currentCallId`             |      0 |
| Sessions or calls in `WRAP_UP`            |      0 |
| Queues                                    |      4 |
| Queues outside the fixed 20-second policy |      0 |
| Queues with overflow                      |      0 |
| Active legacy-owned calls                 |      0 |

Historical legacy-owned calls remain terminal and inert.

## Deployment gate

Before merging, require schema validation, lint, TypeScript, the full functional
suite, and a production build. Before production verification, configure
`CRON_SECRET`. After deployment, prove inbound offer, Answer, one bridge winner,
hangup/release, no-agent voicemail, outbound dial, direct handoff, terminal
history, and outbox recovery.
