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
  reconcile that partial configuration before copying any legacy fact.
- Keep the legacy projections and queue-level rollback available through the
  observation window. Do not destructively roll back database migrations.

## Release order

1. Publish Release PR A with only the SQL migration file. Do not include the
   expanded Prisma schema or application code: a deploy generated from the new
   schema can select new scalar columns before the migration exists. Merge the
   SQL-only PR and let the unchanged application deploy complete. This expand
   migration must keep the legacy
   `call_center_ring_attempt_queueItemId_seatId_key` unique index while adding
   `generation` and the new three-column unique index; the unchanged app relies
   on the legacy index to suppress duplicate station dials.
2. From `main` after Release PR A is merged, run the manual GitHub Actions
   **Production Migrations** workflow with `confirm=DEPLOY`. Do not use
   `prisma db push`; Vercel builds do not run production migrations.
3. Verify the migration completed and the new columns, tables, constraints, and
   indexes exist. If migration proof is missing, stop all application releases.
4. Publish Release PR B with the expanded Prisma schema and the Phase 0
   automatic-ring/readiness repair. Confirm the optical test endpoint rings,
   voicemail fallback still works, and legacy routing remains the only
   command-producing path.
5. Wait until every Release PR A/old application instance has drained, then
   publish a separate SQL-only contract PR that drops only the legacy
   two-column ring-attempt unique index. Run the manual migration workflow and
   verify the new generation index remains. Fresh generation retries are not
   enabled until this contract step; before it, a legacy uniqueness conflict
   must safely suppress the retry.

   ```sql
   DROP INDEX "call_center_ring_attempt_queueItemId_seatId_key";
   ```

6. Configure a strong `CRON_SECRET` and the approved integer
   `CALL_CENTER_WEBHOOK_RETENTION_DAYS` in the production runtime before
   Release PR C. An absent, zero, fractional, or greater-than-3650 retention
   value disables deletion and therefore blocks durable ingress.
7. Publish Release PR C only after migration proof, the Phase 0 synthetic gate,
   secret configuration, and the raw-webhook governance gate below. This release
   may enable durable webhook ingress, command recovery, protected generic
   configuration, and the inactive canonical foundations. Keeping these slices
   in one local implementation diff is acceptable, but they must be separated
   at publish time.
8. After Release PR C deploys, confirm the recovery route rejects a missing or
   incorrect bearer token and accepts only the configured secret. Verify webhook
   acknowledgement, inbox processing, retry, and stale-work recovery with
   sanitized fixtures.
9. Generate the tenant-scoped migration report for one practice. Review every
   ambiguity and copy only confirmed facts through the protected configuration
   API. Start all queues in `LEGACY`.
10. Move one reviewed queue to `SHADOW`. Compare queue, number, membership,
    endpoint, and voicemail decisions without sending generic provider commands.
11. Repeat for the optical queue first, then South Florida, then other queues.
    Do not widen rollout while any mismatch is unexplained.

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

1. Ready endpoint: inbound event is durably recorded, the first eligible test
   endpoint rings, answer and bridge complete, losing test legs cancel, and the
   final state is terminal.
2. No ready endpoint: the queue waits for the configured deadline, voicemail
   starts exactly once, recording is authorized, and the final state is
   terminal.
3. Recovery: replay a duplicate event and one out-of-order fixture; no terminal
   state regresses and no provider command is duplicated.
4. Realtime: refresh and reconnect during idle, ringing, and active states; the
   UI converges to the database snapshot.

Do not move beyond `SHADOW` until the synthetic gates pass, the durable backlog
is empty under normal load, bounded stale `SENT`, dead-letter, and ambiguous
aggregate counts are all zero, and every shadow mismatch has an explicit owner
and resolution.

## Rollback

1. Set the affected queue back to `LEGACY`; this is the first and preferred
   rollback.
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
- zero bounded stale `SENT`, exhausted, dead-letter, and ambiguous aggregates;
- shadow comparison receipt;
- answer/bridge and voicemail synthetic-call receipts;
- empty or bounded-recovering durable backlog;
- queue-level rollback rehearsal; and
- focused tests, Prisma validation, lint, typecheck, and production build.

The migration is not complete while profile-specific routing, dual writes,
legacy queue tables, or compatibility flags remain. Delete them only after all
queues are on the reviewed canonical path and the observation window closes.
