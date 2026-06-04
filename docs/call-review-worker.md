# Production Call Review Worker

This worker reviews real `AgentCall` rows after they are ingested by
`POST /api/livekit/calls`.

The ingestion route does not run Codex inline. It stores the call, marks
reviewable completed calls as `reviewStatus = "pending"`, and returns quickly.
The Mac mini worker polls the production portal database, claims pending calls
as `running`, runs Codex CLI, then writes the structured result back to
`AgentCall.reviewResult`.

## One-shot Run

```bash
bun run calls:review -- --limit 5
```

Review a specific call:

```bash
bun run calls:review -- --call-id <livekit-call-id> --force
```

## Always-on Worker

```bash
CALL_REVIEW_POLL_INTERVAL_MS=10000 bun run calls:review:worker
```

The worker loads `.env.local` before Prisma initializes, so the Mac mini should
point `DATABASE_URL` at the production portal database there.

Useful env vars:

- `CALL_REVIEW_MODEL`: Codex model, default `gpt-5.5`
- `CALL_REVIEW_CODEX_BIN`: Codex binary path, default `codex`
- `CALL_REVIEW_TIMEOUT_MS`: per-call Codex timeout, default `300000`
- `CALL_REVIEW_BATCH_SIZE`: worker batch size, default `5`
- `CALL_REVIEW_POLL_INTERVAL_MS`: idle poll delay, default `10000`
- `CALL_REVIEW_STALE_RUNNING_MINUTES`: requeue stuck running reviews, default `30`
- `CALL_REVIEW_EXIT_WHEN_IDLE=1`: useful for cron-style runs

## Stored Statuses

- `pending`: queued by call ingestion
- `running`: claimed by the worker
- `completed`: AI judge result is stored
- `failed`: review infrastructure failed or the call had no review material

`needsReview` is set from the completed judge result and existing tool-error
signals. Review failures are also marked as needing attention.
