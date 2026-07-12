# Call Center Rollout Runbook

This runbook is the release order for the call-center replacement. The safe
default is off: no activation path is allowed to infer a route,
credential, member, or historical state that cannot be proved from existing
tenant-scoped data.

## Non-negotiable controls

- Deploy the complete canonical cutover default-off. `SHADOW` may compare
  decisions but must not issue provider commands; it is optional and is not an
  activation prerequisite. One automated preflight owns activation readiness.
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
- Keep the legacy projections and one global rollback switch available through
  the observation window. Do not destructively roll back database migrations.

## Release order

PRs #111-#113 are merged and deployed, and the immutable owner migration is
applied. Legacy routing and the legacy frontend remain authoritative while the
generic Phase 4B/5B implementation is completed for every configured number.

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
5. Optionally use `SHADOW` to diagnose routing, configuration, call outcomes,
   tasks, and passive canonical output without sending provider commands. It is
   not a mandatory release stage.
6. Publish Phase 4A canonical command APIs and Phase 5A snapshot, ordered SSE,
   reducer, and media adapter default-off. Do not activate either owner alone.
   Land the effect-free routing decision and operation-receipt primitives first.
   A recovered shadow decision is labeled `RECOVERY`, and a shadow decision
   must never create a `CallCenterCommand` row.
   Before enabling `ACTIVE`, deploy the additive immutable-effect-owner
   migration through the manual **Production Migrations** workflow. Keep every
   queue `LEGACY` or `SHADOW` for that deployment. Verify that historical
   provider inbox rows are backfilled to `LEGACY`, new configured inbound calls
   persist a call-level owner, and session-only or out-of-order callbacks reuse
   that owner without invoking both projectors.
7. Complete Phase 4B routing and Phase 5B frontend for every configured queue
   and phone number. Before merging that application build, merge its additive
   deadline/dependency migration by itself and run **Production Migrations**
   with `confirm=DEPLOY`. Record the successful workflow receipt. The
   always-running recovery cron reads those columns even while activation is
   off, so application-ahead-of-database deployment is prohibited. Then deploy
   the application default-off, run one automated preflight, and
   activate routing and frontend ownership together through one global switch.
   Run controlled live calls against every configured number immediately after
   activation.
8. Complete Phase 6A by removing legacy application reads and writes. Keep the
   tables read-only for a full release window and prove zero runtime access.
9. Publish the separate Phase 6B SQL contract migration only after rollback no
   longer depends on legacy state. Migrate the hybrid voicemail projection
   before dropping legacy tables or columns.

Do not alter a legacy index or constraint without verified production schema
evidence. Do not use `prisma db push`; production migrations run through the
manual **Production Migrations** workflow with `confirm=DEPLOY`.

## Automated activation preflight

Activation is one operator action. It computes the checks below from current
production state and fails closed if any required invariant is false. The
aggregate recovery report remains available for diagnosis, but reading or
approving a report is not a release step. `SHADOW` evidence is not required.

Run the read-only admin endpoint with a canonical endpoint that is reserved for
the controlled test:

`GET /api/admin/call-center/activation-preflight?testEndpointId=<endpoint-id>`

Proceed only when the uncached response has `ready: true`. Then set
`CALL_CENTER_CANONICAL_ACTIVATION_ENABLED=true` and redeploy. Durable commands
for an immutable `CANONICAL` owner continue draining after rollback; the global
switch controls new admissions and frontend ownership, not in-flight cleanup.

The preflight proves the runtime chain as well as database rows. Durable webhook
ingress, approved bounded payload retention, and canonical projection must all
be enabled. Every enabled queue's practice settings must also be enabled with a
Telnyx connection ID.

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

- Keep generic command production and canonical activation blocked until the
  preflight succeeds. Telnyx callbacks may omit `command_id`, so command ID
  matching cannot be the only confirmation path.
- Keep `CALL_CENTER_CANONICAL_ACTIVATION_ENABLED=false` until the preflight is
  ready. This one switch owns new canonical admissions, canonical frontend
  ownership, and new user command admission. Durable commands and required
  lifecycle work for calls already owned by `CANONICAL` continue draining after
  rollback.
- Before activation, persist the command-to-leg relationship and provider call
  identifiers, then prove callbacks correlate to exactly one stored leg by
  provider ID even when `command_id` is absent, duplicated, or delivered out of
  order.
- The preflight computes command and event health directly. After the configured
  confirmation grace, `sentAwaitingConfirmation` must be zero. Any older `SENT`
  command blocks activation until reconciled.
- Provider-event and command dead-letter counts must be zero: no exhausted
  webhook event, no exhausted command, and no `SENDING_OUTCOME_AMBIGUOUS`
  command may remain unresolved. Any event or command that maps to zero or more
  than one canonical aggregate also blocks activation.

### UI and command convergence

- Persist ringing ownership separately from active-call ownership. Routing or
  transfer sets `offeredCallId` while the session remains `AVAILABLE`.
- Only a confirmed provider answer or bridge for that exact offered leg may
  promote it to `currentCallId` and set the session `BUSY`. A browser click,
  command acceptance, or local media state is not connection proof.
- A terminal call or agent leg clears the matching offer or active call. A
  ready session returns to `AVAILABLE`; an explicitly paused or disconnected
  session keeps its non-ready state.
- Send the same canonical `clientInstanceId` to snapshot, stream, and endpoint
  lease APIs. Reject a missing identity rather than selecting another tab.
- Listen only for `projection`, `cursor`, and `reset` SSE events. Apply domain
  types from the projection payload; do not enumerate provider event names.
- One user action keeps one HTTP idempotency key across retry and remount. A
  duplicate for the same target returns the original operation receipt; reuse
  for another target returns a conflict.
- One accepted operation creates at most one intended provider command. The
  operation receipt and provider-effect idempotency key are separate facts.
- `Take` and transfer remain `Connecting` until a canonical event or snapshot
  reports the intended leg `BRIDGED` and call `CONNECTED`, or the durable
  operation `FAILED`. Request completion and browser media state do not clear
  the pending state.
- Snapshot and its global event high-water cursor come from one consistent read.
  Tenant-filtered revision gaps are normal; reconnect resumes with
  `Last-Event-ID` and resets only outside retention or on an unsafe delta.
- Live call state does not use `router.refresh()` or caller-phone correlation.
  Provider contract tests must prove call, leg, endpoint, and provider-ID
  binding before activation.
- Canonical routing and canonical frontend ownership activate and roll back
  together for all configured queues and phone numbers. Legacy and canonical
  paths must never both produce commands for one call.
- If the portal cannot validate the activation snapshot, log only sanitized
  configuration diagnostics and render the legacy workspace. Provider-effect
  APIs remain strict and fail closed; a page-render error must never become a
  routing decision.

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

Use test identities and controlled calls to every configured phone number so
synthetic calls cannot enter patient reporting or follow-up queues. Immediately
after global activation, prove both paths:

1. Ready endpoint: inbound event is durably recorded, the eligible test
   endpoints ring while their agents remain `AVAILABLE`, Take answers and
   bridges exactly once, the winning agent becomes `BUSY` only after provider
   confirmation, losing test legs cancel, and hangup returns the ready agent to
   `AVAILABLE`.
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

Before global activation, the automated preflight must prove configuration
coverage, migration state, callback ownership, and zero stale `SENT`,
dead-letter, or ambiguous command/event counts. The live synthetic gates run
immediately after activation with global rollback available.

## Rollback

1. Set `CALL_CENTER_CANONICAL_ACTIVATION_ENABLED=false` and redeploy. This sends
   new admissions to `LEGACY` and rejects new canonical user operations while
   preserving the immutable owner on calls already admitted.
2. Keep the canonical workspace and media session mounted for already-owned
   calls until they drain. Keep durable webhook capture, lifecycle work, and
   committed command recovery running so those calls can finish safely.
3. Keep canonical and legacy records readable. Reconcile calls that began before
   the mode change; do not delete or rewrite event history.
4. If durable ingress itself is unhealthy, route traffic back to the last known
   application release only after confirming that release is compatible with
   the already-deployed schema.
5. Record the time window, affected numbers, synthetic-call IDs, health counts,
   and rollback decision. Never place caller details or provider credentials in
   the incident log.

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
- zero unexplained configuration ambiguities for enabled queues and numbers;
- persisted leg/provider-ID callback-correlation proof without `command_id`;
- one-operation/one-effect proof across duplicate clicks, retries, remount, and
  concurrent tabs;
- canonical `Connecting` convergence without route refresh or caller-phone
  correlation;
- zero bounded stale `SENT`, exhausted, dead-letter, and ambiguous aggregates;
- answer/bridge and voicemail synthetic-call receipts;
- empty or bounded-recovering durable backlog;
- zero compatibility-bridge mismatches through the observation window;
- Phase 6A receipt proving zero legacy runtime reads and writes for a full
  release window before the Phase 6B SQL contract migration;
- global rollback rehearsal; and
- focused tests, Prisma validation, lint, typecheck, and production build.

The migration is not complete while profile-specific routing, dual writes,
legacy queue tables, or compatibility flags remain. Delete them only after all
queues are on the reviewed canonical path and the observation window closes.
