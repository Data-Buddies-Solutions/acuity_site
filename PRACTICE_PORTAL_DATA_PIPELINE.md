# Practice Portal Data Pipeline

## Source of Truth

The portal database should be the source of truth for practice-facing operations and internal admin analytics.

Current core tables:

- `Practice`, `PracticeMembership`, `PracticeLocation`, `PracticeProvider`
- `PracticeKnowledgeBase`, `PracticeInsuranceCrosswalk`
- `PracticeAgent`, `PracticePhoneNumber`
- `AgentCall`, `UsageCostLineItem`

The customer portal should read from these tables and show practice-value metrics. The internal admin portal can expose technical diagnostics, latency, raw payloads, review results, and costs.

## Current State

The portal now has two call data paths:

1. Historical bridge from `call-analytics`
   - `scripts/import-abita-analytics.mjs` reads the sibling `../call-analytics` database.
   - It backfills Abita Eye Group calls, reviews, tool outcomes, estimated costs, agents, locations, and phone mappings into the portal database.
   - This is useful for demo/local history, but it should not be the long-term live path.

2. Portal-native forward sync
   - `POST /api/livekit/calls`
   - Auth is optional during migration. If `LIVEKIT_FORWARD_SYNC_SECRET` or `WEBHOOK_SECRET` is configured, requests must send `Authorization: Bearer <secret>`. If no secret is configured, the endpoint accepts unauthenticated posts and logs a production warning.
   - This endpoint normalizes both legacy call-summary payloads and the current LiveKit observability payload shape (`usage`, `llmMetrics`, `turnMetrics`, `sessionReport`) into `AgentCall` and estimated `UsageCostLineItem` rows.
   - It resolves the practice by explicit `practiceId` or by `officePhone` through `PracticePhoneNumber`.

If the live agent is not posting to `/api/livekit/calls` yet, the portal is not fully live from the agent. It is either showing imported data or any calls posted directly to the new endpoint.

## Target Live Flow

The agent should post the exact call payload to the portal at call end:

1. LiveKit call finishes.
2. Agent builds a call summary payload with:
   - `callId`
   - `practiceId` when available
   - `callerPhone`
   - `officePhone`
   - `startedAt`, `endedAt`, `durationSec`
   - transcript/session turns
   - tool calls and tool results
   - booking, transfer, confirmation, cancellation outcomes
   - latency metrics
   - token/voice usage
   - model/fallback metadata
   - review result when available
   - optional audio payload when small enough and allowed
3. Agent posts to `POST /api/livekit/calls`.
4. Portal upserts `AgentCall`.
5. Review worker updates `AgentCall.reviewResult`, `reviewStatus`, `reviewAverageScore`, and `needsReview`.
6. Customer portal reads value metrics from `AgentCall`.
7. Admin portal reads the same rows plus technical diagnostics.

## Customer Portal Boundaries

Practice-facing pages should stay operational and non-technical:

- Calls handled
- Total call minutes
- Average time per call
- Transfer rate
- Appointments booked
- Escalations and callbacks
- Peak call times
- Staff time saved
- Call outcomes

Raw payloads, latency traces, token costs, model fallback, and tool debugging belong in `/admin`.

## Vendor Cost Model

Admin cost estimates use the current vendor-rate calculator in `lib/pricing.ts`:

- LiveKit media: `$0.0100 / minute`
- Telnyx SIP inbound: `$0.0035 / minute`
- AssemblyAI STT: `$0.0075 / minute`
- Baseten GLM-4.7 input: `$0.60 / 1M tokens`
- Baseten GLM-4.7 cached input: `$0.12 / 1M tokens`
- Baseten GLM-4.7 output: `$2.20 / 1M tokens`
- ElevenLabs Flash TTS: `$0.05 / 1K characters`

The admin analytics Costs tab shows total estimated vendor cost, cost per call, cost per minute, and the line-item breakdown for the selected practice/range.

## Migration Plan

1. Keep `call-analytics` as a temporary backfill/source bridge.
2. Point the live agent at `POST /api/livekit/calls`.
3. Add a portal review worker that updates `AgentCall` directly.
4. Backfill enough historical calls into `AgentCall` for demo and trend continuity.
5. Move admin call detail and analytics fully onto portal tables.
6. Stop relying on `call-analytics` once ingestion, review updates, and admin views are stable.

## Immediate Next Actions

1. Configure the LiveKit agent to post call-end payloads to `/api/livekit/calls`.
2. Ensure every live practice has `PracticePhoneNumber` rows for each routed office number.
3. Decide whether the agent will send `practiceId` directly; this is more reliable than resolving only by phone number.
4. Keep unauthenticated ingestion only long enough to verify the migration, then set a shared secret in the portal and LiveKit agent.
5. Move the review worker output into `AgentCall.reviewResult`.
6. Add a small ingestion smoke test that posts a fixture payload and verifies the portal overview updates.
7. Add customer-facing call outcome fields if appointment review needs more structured data than tool payload parsing can provide.
