# Data Ownership and Ingestion

Last reviewed: 2026-07-21

## Decision

Postgres in `acuity_site` is the source of truth for practice configuration,
AI receptionist outcomes, staff call-center state, tasks, document revisions,
and SMS conversations. External runtimes report facts or execute effects; they
do not own application lifecycle state.

## Ownership

- `Practice` is the tenant root.
- `PracticeMembership` and its location scope authorize portal access.
- `PracticePhoneNumber` maps routed phone numbers to a practice and optional
  location.
- `AgentCall`, `AgentTask`, and `UsageCostLineItem` own AI receptionist outcomes
  and usage evidence.
- `CallCenterCall`, `CallCenterCallLeg`, `CallCenterTask`, and
  `CallCenterVoicemail` own staff call-center operations.
- `CallCenterCommand`, `ProviderWebhookEvent`, and `CallCenterEvent` own durable
  provider effects, callback receipt, and audit evidence.
- Knowledge and insurance documents use draft, revision, review, and published
  state owned by the portal database.
- SMS conversations and messages are scoped through practice-owned phone
  numbers.

## Ingress

The AI receptionist uses authenticated endpoints:

- `POST /api/livekit/calls` upserts a normalized final `AgentCall`.
- `POST /api/livekit/tasks` stores an idempotent `AgentTask`.
- `POST /api/livekit/webhooks` records verified lifecycle evidence and may
  create a minimal call when final synchronization is absent.

Practice resolution prefers an explicit `practiceId` and otherwise resolves the
called office number through `PracticePhoneNumber`.

Telnyx voice and SMS callbacks enter through `POST /api/telnyx/webhooks`.
Signature verification belongs to the HTTP adapter. Durable receipt,
deduplication, admission, projection, and committed effects belong to the
corresponding application modules.

## Read Models

Practice-facing pages translate the durable records into operational metrics,
bookings, transcripts, tasks, call history, and conversations. Internal admin
pages read the same records with additional diagnostics, costs, provider
evidence, latency, and review details.

Historical import scripts may backfill records, but they are not live sources of
truth. Do not introduce a second database owner for current application state.
