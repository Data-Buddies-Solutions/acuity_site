# Practice Portal Data Pipeline

## Source of Truth

The portal database should be the source of truth for practice-facing operations and internal admin analytics.

Current core tables:

- `Practice`, `PracticeMembership`, `PracticeLocation`, `PracticeProvider`
- `PracticeKnowledgeBase`, `PracticeInsuranceCrosswalk`
- `PracticeAgent`, `PracticePhoneNumber`
- `AgentCall`, `UsageCostLineItem`
- `PracticeCallCenterSettings`, `CallCenterSession`, `CallCenterMissedCall`, `CallCenterVoicemail`

Practice branding is stored directly on `Practice`:

- `brandLogoUrl`, `brandLogoAlt`, `brandMarkUrl`
- `brandPrimaryColor`, `brandAccentColor`

Logos should be stable hosted assets, preferably Vercel Blob URLs. Next.js image loading is configured for `*.public.blob.vercel-storage.com`.

The customer portal should read from these tables and show practice-value metrics. The internal admin portal can expose technical diagnostics, latency, raw payloads, review results, and costs.

## Current State

The portal now has four practice data paths:

1. Historical bridge from `call-analytics`
   - `scripts/import-abita-analytics.mjs` reads the sibling `../call-analytics` database.
   - It backfills Abita Eye Group calls, reviews, tool outcomes, estimated costs, agents, locations, and phone mappings into the portal database.
   - This is useful for demo/local history, but it should not be the long-term live path.

2. Portal-native forward sync
   - `POST /api/livekit/calls`
   - Auth is required. Configure `LIVEKIT_FORWARD_SYNC_SECRET` (or `WEBHOOK_SECRET`) and have the caller send `Authorization: Bearer <secret>`. Requests with a missing/incorrect bearer token are rejected with `401`. If no secret is configured the endpoint is disabled and returns `503` (the previous behavior of accepting unauthenticated posts has been removed).
   - This endpoint normalizes both legacy call-summary payloads and the current LiveKit observability payload shape (`usage`, `llmMetrics`, `turnMetrics`, `sessionReport`) into `AgentCall` and estimated `UsageCostLineItem` rows.
   - It resolves the practice by explicit `practiceId` or by `officePhone` through `PracticePhoneNumber`.

3. Practice opt-in Telnyx call center
   - `/portal/app/call-center`
   - `POST /api/telnyx/webhooks`
   - Enabled practices get a browser WebRTC softphone, active-session counts, missed-call callback queue, and voicemail inbox.
   - Telnyx webhooks are verified with `TELNYX_PUBLIC_KEY` and scoped to enabled `PracticeCallCenterSettings` rows. Inbound webhooks resolve by the practice-owned `to` number; outbound webhooks resolve by the practice-owned `from` number.
   - Connection-ID fallback is intentionally conservative. It only applies when a webhook has no usable practice phone number and exactly one enabled settings row matches the connection. If a phone number is present but does not match a configured practice number, the event is ignored instead of being attributed by shared connection ID.
   - Telnyx runtime defaults can come from env vars while per-practice overrides live in `PracticeCallCenterSettings`.
   - Open queue KPIs use database counts, while the page lists the latest 20 unresolved missed calls and voicemails.

4. Practice branding
   - `Practice` owns customer branding fields, not cookies or local assets.
   - Portal shell, overview, and call center render the practice logo when `brandLogoUrl` is set.
   - Use `scripts/set-practice-branding.mjs <user-email> <logo-url> [logo-alt] [primary-color] [accent-color] [mark-url]` to update a practice row.

The current Abita demo row for `demo@acuity.local` is configured with the Abita Eye Group Vercel Blob logo, primary/accent colors, and call-center settings for the 727 caller/inbound number.

If the live agent is not posting to `/api/livekit/calls` yet, the portal is not fully live from the agent. It is either showing imported data or any calls posted directly to the new endpoint.

If inbound calls should pop in `/portal/app/call-center`, Telnyx must route the practice number to the WebRTC credential/connection used by the portal softphone, the staff browser must be signed in with the page open, and the deployed app must expose `POST /api/telnyx/webhooks`. Localhost can place/receive browser WebRTC calls only when Telnyx can reach the configured route or the number is routed directly to the registered WebRTC client.

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

## Call Center Model

The practice-owned call center is intentionally opt-in per practice.

- `PracticeCallCenterSettings` stores enablement, provider, Telnyx connection/credential IDs, inbound number, caller ID, voicemail greeting, and recording behavior.
- `CallCenterSession` stores live Telnyx call session state and links to `AgentCall` when client state provides a matching call ID.
- `CallCenterMissedCall` stores unresolved callback work.
- `CallCenterVoicemail` stores recording metadata and listened/resolved state.
- `PracticePhoneNumber` remains the routing bridge for phone-to-practice ownership and should contain every live office/call-center number.

For scale, webhook lookup indexes exist on enabled settings by inbound number, outbound caller number, and Telnyx connection ID. Do not rely on shared connection ID as the primary tenant boundary; phone number ownership or explicit `practiceId` should be the durable routing signal.

## Vendor Cost Model

Admin cost estimates use the current vendor-rate calculator in `lib/pricing.ts`:

- LiveKit media: `$0.0100 / minute`
- Telnyx SIP inbound: `$0.0035 / minute`
- AssemblyAI STT: `$0.0075 / minute`
- Baseten GLM-4.7 input: `$0.60 / 1M tokens`
- Baseten GLM-4.7 cached input: `$0.12 / 1M tokens`
- Baseten GLM-4.7 output: `$2.20 / 1M tokens`
- Cartesia Sonic 3.5 TTS: `$39 / 1M characters`

The admin analytics Costs tab shows total estimated vendor cost, cost per call, cost per minute, and the line-item breakdown for the selected practice/range.

## Migration Plan

1. Keep `call-analytics` as a temporary backfill/source bridge.
2. Point the live agent at `POST /api/livekit/calls`.
3. Add a portal review worker that updates `AgentCall` directly.
4. Backfill enough historical calls into `AgentCall` for demo and trend continuity.
5. Manage practice call-center settings and branding from admin UI instead of scripts.
6. Move admin call detail and analytics fully onto portal tables.
7. Stop relying on `call-analytics` once ingestion, review updates, and admin views are stable.

## Immediate Next Actions

1. Configure the LiveKit agent to post call-end payloads to `/api/livekit/calls`.
2. Ensure every live practice has `PracticePhoneNumber` rows for each routed office number.
3. Decide whether the agent will send `practiceId` directly; this is more reliable than resolving only by phone number.
4. Set the shared `LIVEKIT_FORWARD_SYNC_SECRET` (or `WEBHOOK_SECRET`) in both the portal and the LiveKit agent; ingestion is rejected until it is configured.
5. Move the review worker output into `AgentCall.reviewResult`.
6. Add a small ingestion smoke test that posts a fixture payload and verifies the portal overview updates.
7. Add customer-facing call outcome fields if appointment review needs more structured data than tool payload parsing can provide.
8. Configure each call-center practice with Telnyx connection, credential, inbound, caller-ID, and `PracticePhoneNumber` values before enabling staff softphone access.
9. Deploy the Telnyx webhook route before expecting public inbound events to update call-center queues.
10. Add admin screens for branding and call-center settings so production operators do not need direct DB scripts.
