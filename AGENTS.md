# Agent Guide

Start with `README.md`. It defines the repository map, domain language, runtime
boundaries, local setup, and validation commands.

## Invariants

- Postgres owns durable application state.
- External providers deliver events and execute effects; they do not own the
  application lifecycle.
- Keep `AgentCall` and `CallCenterCall` separate.
- The call-center browser renders server state and owns media only.
- Preserve tenant, location, queue, user, session, and call authorization.
- Never regress terminal call, leg, command, or provider-event state.

## Placement

- Route and HTTP translation: `app/` and `app/api/`.
- Business behavior: `lib/`.
- Call-center domain/application/infrastructure: `lib/call-center/`.
- Shared UI primitives: `components/ui/`.
- Persistent state: `prisma/schema.prisma` plus a forward migration.
- Durable architecture and operations docs: `docs/architecture/` and
  `docs/runbooks/`.

Prefer one owner, one state, and one source of truth. Delete pass-through modules
and stale plans when their removal does not push complexity into callers. Keep
provider adapters and database implementations behind narrow interfaces.

## Validation

Run the smallest relevant test first, then before handoff run:

```bash
bun run format:check
bun run check
```

For release-sensitive changes, also run `bun run build`. Never use
`prisma db push` against production.

## Agent skills

### Issue tracker

Issues and PRDs live in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical GitHub triage labels. See
`docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.
