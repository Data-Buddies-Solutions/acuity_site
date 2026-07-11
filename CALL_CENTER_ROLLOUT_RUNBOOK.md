# Call Center Rollout Runbook

This runbook is the release order for the staged call-center migration. The
safe default is to stop: no script or report is allowed to infer a route,
credential, member, or historical state that cannot be proved from existing
tenant-scoped data.

## Non-negotiable controls

- Keep every new queue in `LEGACY` while configuration is reviewed. `SHADOW`
  may compare decisions but must not issue provider commands. `ACTIVE` is not a
  migration mode and remains rejected until the routing cutover is separately
  approved.
- Treat `GET /api/admin/call-center/practices/{practiceId}/migration-report` as
  a read-only aid. It cannot apply a backfill and redacts raw phone numbers,
  voicemail greetings, emails, seat labels, provider credentials, and SIP
  usernames.
- Resolve every reported ambiguity manually. Never choose a queue from call
  volume, a similar label, or the first row returned.
- If the report finds existing generic queues, numbers, or endpoints, stop and
  reconcile them. The guarded bootstrap accepts only its exact previously
  committed snapshot as an idempotent replay; any partial or different
  configuration is a hard stop.
- Read generic configuration with
  `GET /api/admin/call-center/practices/{practiceId}/configuration`, then send
  its strong `ETag` in `If-Match` on `PUT`. A stale version is a hard stop.
- Endpoint credential and SIP values are write-only. Omit them to preserve the
  stored values, send `null` to clear them, and never copy them into evidence.
- An enabled queue, number, endpoint, or queue membership must be explicitly
  disabled before it may be omitted. Omitted disabled rows remain stored for
  review and rollback.
- The first generic configuration write is rejected unless the Phase 2A report
  is `READY_FOR_MANUAL_REVIEW`. Later edits do not re-run that bootstrap gate
  because the report intentionally blocks when generic rows already exist.
- Review the same redacted report on the practice admin **Call center** tab.
  The view is read-only and never exposes an apply action.
- Record the full report version shown on that tab. For a one-time legacy
  bootstrap, run **Bootstrap Call Center Configuration** from `main` with the
  practice ID, that exact version, and
  `confirm=BOOTSTRAP:<practice_id>`. Any report drift, ambiguity, or existing
  configuration other than the exact bootstrap candidate is a hard stop. An
  exact replay is a locked no-op. The workflow writes every queue as `LEGACY`
  and logs counts and versions only; the audit event records the original and
  triggering GitHub actors plus workflow run ID and attempt.
- An identical `PUT` replay is a locked no-op and emits no duplicate audit
  event. Use the returned committed snapshot and `ETag`; do not reread to infer
  what the request committed.
- Keep the legacy projections and queue-level rollback available through the
  observation window. Do not destructively roll back database migrations.

## Release order

PRs #83, #84, #86, and #87 are merged and deployed. The additive schema is
clean, but legacy routing, projections, and route-refresh UI remain
authoritative. The post-#87 duplicate Take burst keeps the coordination gate
open.

1. Configure a strong `CRON_SECRET` and the approved integer
   `CALL_CENTER_WEBHOOK_RETENTION_DAYS` in the production runtime before
   durable ingress. An absent, zero, fractional, or greater-than-3650 retention
   value disables deletion and blocks that release.
2. Publish Phase 1 durable ingress and recovery without changing the production
   routing owner. Confirm the recovery route rejects a missing or
   incorrect bearer token and accepts only the configured secret. Verify webhook
   acknowledgement, inbox processing, retry, and stale-work recovery with
   sanitized fixtures.
3. Publish Phase 2 generic configuration and endpoint leasing. Generate the
   tenant-scoped migration report for one practice. Review every
   ambiguity and apply the exact reviewed version through the guarded bootstrap
   workflow. Start all queues in `LEGACY`; later edits use the protected
   configuration API.
4. Publish Phase 3 passive canonical projection with
   `CALL_CENTER_CANONICAL_PROJECTION_ENABLED=false`. Confirm generic number,
   queue, and endpoint mappings first, then enable the projection worker only.
   Durable webhook ingress must remain enabled whenever passive projection is
   enabled.
   Legacy remains the sole routing and provider-effect owner. The passive lane
   must not issue commands or write any legacy projection; canonical facts,
   revisioned event, and checkpoint completion commit atomically.
   Confirm successful webhooks schedule one failure-contained post-response
   canonical attempt, while failed, stale, or unscheduled attempts remain
   claimable by the existing bounded recovery cron. Test both bridge/voicemail
   delivery orders and later agent callbacks without `client_state`.
5. Move one reviewed queue to `SHADOW`. Compare routing, configuration, call
   outcomes, tasks, and passive canonical output without sending canonical
   provider commands.
6. Publish Phase 4A canonical command APIs and Phase 5A snapshot, ordered SSE,
   reducer, and media adapter in shadow. Do not activate either owner alone.
7. Activate Phase 4B routing and Phase 5B frontend together for optical. Repeat
   for South Florida and then other queues only after every gate below passes.
8. Complete Phase 6A by removing legacy application reads and writes. Keep the
   tables read-only for a full release window and prove zero runtime access.
9. Publish the separate Phase 6B SQL contract migration only after rollback no
   longer depends on legacy state. Migrate the hybrid voicemail projection
   before dropping legacy tables or columns.

Do not alter a legacy index or constraint without verified production schema
evidence. Do not use `prisma db push`; production migrations run through the
manual **Production Migrations** workflow with `confirm=DEPLOY`.

## Production activation gates

Every gate below is a hard stop. Recheck them before first customer traffic and
before expanding a queue or tenant.

### Browser readiness

- Readiness defaults to false after deployment. Refresh every call-center
  browser so it loads the current client; do not rely on an already-open tab.
- In the refreshed browser, select the correct station, choose **Enable
  calling**, grant microphone and audio playback access, and wait for the
  server-acknowledged ready state.
- Before routing live traffic, verify at least one intended endpoint has a
  current heartbeat and is ready in the server-side view. A green browser-only
  indicator is not sufficient proof.
- Keep one active browser per Telnyx credential/SIP identity and deliberately
  low call concurrency until a concurrent check-in test proves an atomic
  session lease: one winner, lease expiry, reconnect, and loser demotion must
  all be deterministic. Do not scale on browser presence alone.

### Command and canonical correlation

- Keep generic command production and canonical activation blocked; queues stay
  `LEGACY` or decision-only `SHADOW`. Telnyx callbacks may omit `command_id`, so
  command ID matching cannot be the only confirmation path.
- Before activation, persist the command-to-leg relationship and provider call
  identifiers, then prove callbacks correlate to exactly one stored leg by
  provider ID even when `command_id` is absent, duplicated, or delivered out of
  order.
- After waiting at least the configured command confirmation grace, the recovery
  aggregate `sentAwaitingConfirmation` must be zero. Any older `SENT` command
  blocks command production and canonical activation until reconciled.
- Provider-event and command dead-letter aggregates must be zero: no exhausted
  webhook event, no exhausted command, and no `SENDING_OUTCOME_AMBIGUOUS`
  command may remain unresolved. Any event or command that maps to zero or more
  than one canonical aggregate also blocks activation.

### UI and command convergence

- One user action keeps one HTTP idempotency key across retry and remount. A
  duplicate for the same target returns the original operation receipt; reuse
  for another target returns a conflict.
- One accepted operation creates at most one intended provider command. The
  operation receipt and provider-effect idempotency key are separate facts.
- `Take` and transfer remain `Connecting` until a canonical event or snapshot
  reports `ACTIVE` or `FAILED`. Request completion and browser media state do
  not clear the pending state.
- Snapshot and its global event high-water cursor come from one consistent read.
  Tenant-filtered revision gaps are normal; reconnect resumes with
  `Last-Event-ID` and resets only outside retention or on an unsafe delta.
- Live call state does not use `router.refresh()` or caller-phone correlation.
  Provider contract tests must prove call, leg, endpoint, and provider-ID
  binding before activation.
- Canonical routing and canonical frontend ownership activate and roll back
  together for each queue. Legacy and canonical paths must never both produce
  commands for one call.

### Raw webhook governance

- Durable production ingress remains blocked until an owner approves the raw
  webhook payload retention period, permitted roles, access-audit requirements,
  export restrictions, and deletion or legal-hold procedure. Raw payloads may
  contain protected caller data.
- New session and queue projections must retain only sanitized routing facts,
  never another raw payload copy. Inventory and remediate legacy
  `call_center_session.metadata.payload` and
  `call_center_queue_item.metadata.payload` rows under the same approved
  retention policy before claiming the data is retention-bounded.
- Deploy and test the bounded recovery-route purge before ingress: it must delete only
  terminal events older than the approved retention boundary, work in limited
  batches with a runtime deadline, skip live/recoverable work, and report
  scanned, deleted, deferred, and failed counts without logging payloads.
- Prove unauthorized users cannot read raw payloads and that application logs,
  recovery summaries, and purge receipts contain only categorical metadata.
  Until both policy and purge proof exist, do not deploy code that
  unconditionally persists production webhook payloads.

## Synthetic call gates

Use dedicated test identities and a dedicated test number so synthetic calls
cannot enter patient reporting or follow-up queues. Before each expansion,
prove both paths:

1. Ready endpoint: inbound event is durably recorded, the eligible test
   endpoints ring, answer and bridge complete once, losing test legs cancel,
   and the final state is terminal.
2. Command convergence: one click, repeated clicks, concurrent tabs, request
   retry, component remount, and reconnect create one operation receipt and one
   intended provider effect. The UI stays `Connecting` until canonical state
   resolves it.
3. No ready endpoint: the queue waits for the configured deadline, voicemail
   starts exactly once, recording is authorized, and the final state is
   terminal.
4. Recovery: replay a duplicate event and one out-of-order fixture; no terminal
   state regresses and no provider command is duplicated.
5. Realtime: refresh and reconnect during idle, ringing, connecting, and active
   states; the UI converges to the database snapshot without route refresh.
6. Transfer and correlation: transfer Take follows the same command contract,
   and provider callbacks bind to one call leg even when `command_id` is absent.

Do not activate a customer queue beyond `SHADOW` until the synthetic gates pass
on a dedicated test queue, the durable backlog is empty under normal load,
bounded stale `SENT`, dead-letter, and ambiguous aggregate counts are all zero,
and every shadow mismatch has an explicit owner and resolution.

## Rollback

1. Set both routing and frontend ownership for the affected queue back to
   `LEGACY`; this is the first and preferred rollback.
2. Stop new generic provider commands, but keep durable webhook capture and
   recovery running so evidence is not lost.
3. Keep canonical and legacy records readable. Reconcile calls that began before
   the mode change; do not delete or rewrite event history.
4. If durable ingress itself is unhealthy, route traffic back to the last known
   application release only after confirming that release is compatible with
   the already-deployed schema.
5. Record the exact queue, time window, synthetic-call IDs, backlog counts, and
   rollback decision. Never place caller details or provider credentials in the
   incident log.

After Phase 6A begins, do not proceed to the Phase 6B contract migration until
the canonical rollback path is rehearsed and no rollback depends on a legacy
write.

## Completion evidence

- production migration workflow receipt;
- `CRON_SECRET` authorization check and recovery health;
- refreshed-browser readiness receipt with a selected station, enabled calling,
  microphone/audio grants, and at least one server-verified ready endpoint;
- one-browser-per-credential control and low-concurrency limit, or proof of the
  atomic session lease under concurrent check-in and reconnect;
- approved raw-webhook retention/access policy and bounded purge-job receipt;
- zero unexplained migration-report ambiguities for the queue being tested;
- persisted leg/provider-ID callback-correlation proof without `command_id`;
- one-operation/one-effect proof across duplicate clicks, retries, remount, and
  concurrent tabs;
- canonical `Connecting` convergence without route refresh or caller-phone
  correlation;
- zero bounded stale `SENT`, exhausted, dead-letter, and ambiguous aggregates;
- shadow comparison receipt;
- answer/bridge and voicemail synthetic-call receipts;
- empty or bounded-recovering durable backlog;
- zero compatibility-bridge mismatches through the observation window;
- Phase 6A receipt proving zero legacy runtime reads and writes for a full
  release window before the Phase 6B SQL contract migration;
- queue-level rollback rehearsal; and
- focused tests, Prisma validation, lint, typecheck, and production build.

The migration is not complete while profile-specific routing, dual writes,
legacy queue tables, or compatibility flags remain. Delete them only after all
queues are on the reviewed canonical path and the observation window closes.
