# Acuity Health Portal

Private internal application for Acuity Health. This repo contains the public
marketing site, the practice portal, the internal admin command center, and the
portal-owned call analytics/call-center backend.

The production direction is practice-owned data in this app. Legacy/imported call
analytics can still be backfilled from the sibling `call-analytics` project, but
new call history, customer-facing metrics, admin diagnostics, branding, and
Telnyx call-center state should live in this database.

## Runtime

- Framework: Next.js 16 App Router
- Runtime: React 19, TypeScript, Bun
- Database: Postgres through Prisma 7 and `@prisma/adapter-pg`
- Auth: Better Auth with Prisma tables
- Telephony: LiveKit call ingestion and Telnyx WebRTC/call-control surfaces
- Styling: Tailwind CSS
- Charts/UI: Recharts, lucide-react, local UI primitives

## Product Surfaces

- `/` and public pages: marketing site and SEO content.
- `/portal`: staff login and redirect gate.
- `/portal/app`: practice workspace shell. Routes launched practices to overview and setup practices to onboarding.
- `/portal/app/onboarding`: setup flow for practice basics, locations, providers, insurance, and knowledge base.
- `/portal/app/overview`: customer-facing operational call summary.
- `/portal/app/call-center`: canonical inbound queue, browser calling, outbound dialing, follow-up tasks, and call history.
- `/portal/app/knowledge-base`: launched-practice markdown knowledge bases, split by location, with admin-reviewed edits.
- `/portal/app/insurance-crosswalk`: launched-practice Insurance Rules, split by location, with structured JSON edits and admin review.
- `/admin/practices`: internal practice command center and analytics.
- `/admin/practices/[practiceId]/calls/[callId]`: technical call detail, transcript, review, audio, costs, latency, tokens, and tool diagnostics.
- `/admin/knowledge-base`: review queue for practice-submitted knowledge-base drafts.
- `/admin/insurance-rules`: review queue for practice-submitted Insurance Rules drafts.

## Data Model

Core practice/workspace tables:

- `Practice`
- `PracticeMembership`
- `PracticeLocation`
- `PracticeProvider`
- `PracticeKnowledgeBase`
- `PracticeKnowledgeDocument`
- `PracticeKnowledgeDocumentRevision`
- `PracticeInsuranceCrosswalk`
- `PracticeInsuranceRuleSet`
- `PracticeInsuranceRuleRevision`
- `PracticeWebsiteScan`
- `AdminAlert`

Call analytics tables:

- `PracticeAgent`
- `PracticePhoneNumber`
- `AgentCall`
- `UsageCostLineItem`

Call-center tables:

- `PracticeCallCenterSettings`
- `CallCenterQueue`, `CallCenterQueueLocation`, `CallCenterQueueMember`
- `CallCenterNumber`, `CallCenterEndpoint`, `CallCenterAgentSession`
- `CallCenterCall`, `CallCenterCallLeg`, `CallCenterHandoff`
- `CallCenterCommand`, `CallCenterEvent`, `ProviderWebhookEvent`
- `CallCenterTask`
- `CallCenterVoicemail`

Branding fields live directly on `Practice`:

- `brandLogoUrl`
- `brandLogoAlt`
- `brandMarkUrl`
- `brandPrimaryColor`
- `brandAccentColor`

`PracticePhoneNumber` is the routing bridge when an ingestion payload or Telnyx
webhook must be resolved to a practice by phone number. Prefer explicit
`practiceId` when an upstream system can send it.

## Main Flows

### Auth And Workspace

1. Staff signs in through `/portal`.
2. `app/portal/page.tsx` redirects authenticated admins to `/admin/practices`.
3. Non-admin staff enters `/portal/app`.
4. `lib/portal-state.ts` loads Prisma-backed workspace state from `lib/practice-workspace.ts`.
5. Cookie workspace state exists only as a fallback when workspace tables are unavailable.
6. Launched practices land on `/portal/app/overview`; setup practices stay in onboarding.

### Practice Onboarding

1. The user captures practice basics, locations, providers, insurance rules, and knowledge-base rules.
2. `lib/practice-workspace.ts` persists structured records to the practice-owned tables.
3. Launch readiness is derived from stored records, not from local UI state.
4. Launched practices can still edit Knowledge Base and Insurance Rules documents through route-backed edit mode.

### Practice Documents And Admin Review

1. Knowledge Base documents are stored as markdown revisions in `PracticeKnowledgeDocument`.
2. Insurance Rules are stored as structured JSON revisions in `PracticeInsuranceRuleSet`.
3. Multi-location practices get one active document/rule set per location.
4. Practice-submitted edits create pending revisions and `AdminAlert` rows.
5. The currently published revision remains live until admin approval.
6. Admins approve or reject drafts from `/admin/knowledge-base` and `/admin/insurance-rules`.

### LiveKit Call Ingestion

1. LiveKit/agent posts call-end payloads to `POST /api/livekit/calls`.
2. `lib/call-normalization.ts` normalizes legacy and current observability payload shapes.
3. `lib/call-ingestion.ts` upserts `AgentCall` by `callId`.
4. Cost line items are estimated through `lib/pricing.ts` and stored in `UsageCostLineItem`.
5. Practice resolution uses explicit `practiceId` first, then `officePhone` through `PracticePhoneNumber`.
6. Customer portal reads value metrics from `AgentCall`; admin reads technical diagnostics from the same rows.

### Telnyx Call Center

1. An enabled `CallCenterNumber` maps each inbound number to one enabled queue.
2. An enabled `CallCenterEndpoint` assigns one Telnyx WebRTC identity to one
   portal user; queue membership determines which calls that user may answer.
3. The portal acquires a short browser lease and requests provider credentials
   through the canonical agent-session APIs.
4. Verified Telnyx callbacks enter the durable webhook inbox and update the
   canonical call, leg, event, task, and voicemail tables.
5. The ordered SSE stream updates every eligible browser. `Take` atomically
   claims one call; ringing alone does not make the user busy.
6. Outbound caller IDs and direct-handoff routing come from the same database
   configuration. Provider credentials and webhook verification keys remain
   operational secrets.

Use the admin practice configuration API/UI for call-center setup. The complete
runtime and deployment contract is documented in
`CALL_CENTER_PLATFORM_SPEC.md` and `CALL_CENTER_ROLLOUT_RUNBOOK.md`.

### Practice Branding

Branding is database-owned. Logos should be hosted in Vercel Blob or another
image host explicitly allowed in `next.config.ts`.

Use the script for one-off updates:

```bash
bun scripts/set-practice-branding.mjs demo@acuity.local https://example.com/logo.png "Practice logo" "#009ec3" "#123f7a"
```

The portal shell, overview, call center, and bookings pages render the practice logo when
`brandLogoUrl` is set.

## Environment

Create `.env.local` for local development. Never commit real secrets.

Required for normal local app work:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/acuity_portal?schema=public"
BETTER_AUTH_SECRET="replace-with-a-long-random-secret"
BETTER_AUTH_URL="http://localhost:3000"
PORTAL_ALLOW_SIGNUP="false"
```

Optional/production operational settings:

```bash
ADMIN_EMAILS=""
ACUITY_ADMIN_EMAILS=""
LIVEKIT_FORWARD_SYNC_SECRET=""
WEBHOOK_SECRET=""
TELNYX_API_KEY=""
TELNYX_PUBLIC_KEY=""
TELNYX_ALLOW_UNVERIFIED_WEBHOOKS="false"
CALL_CENTER_DIRECT_HANDOFF_SIP_URI=""
CALL_CENTER_HANDOFF_ABITA_PRACTICE_ID=""
CALL_CENTER_HANDOFF_ABITA_SECRET=""
```

Use `TELNYX_ALLOW_UNVERIFIED_WEBHOOKS=true` only for local webhook testing
without a Telnyx public key. Production should always verify Telnyx signatures.

## Local Development

Install dependencies:

```bash
bun install
```

Generate Prisma client:

```bash
bun run prisma:generate
```

Run the app:

```bash
bun run dev
```

Open `http://localhost:3000`.

## Scripts

- `bun run dev`: start Next.js dev server.
- `bun run build`: generate Prisma client and run a production Next.js build.
- `bun run start`: start the built app.
- `bun run lint`: run ESLint.
- `bun run typecheck`: run TypeScript without emitting files.
- `bun run format`: format the repo with Prettier.
- `bun run format:check`: verify Prettier formatting for changed files.
- `bun test`: run Bun tests.
- `bun run prisma:generate`: generate Prisma client into `generated/prisma`.
- `bun run prisma:validate`: validate Prisma schema.
- `bun run prisma:migrate`: run local Prisma migration development flow.
- `bun run prisma:studio`: open Prisma Studio.
- `bun run check`: Prisma validate, lint, typecheck, and tests.
- `bun run ci`: `check` plus production build.

## Prisma And Migrations

Schema lives at `prisma/schema.prisma`.

Generated client output:

```text
generated/prisma
```

Production/shared databases should be migrated with:

```bash
bunx prisma migrate deploy
```

Production migrations run from the GitHub Actions workflow
`.github/workflows/production-migrations.yml`, not from Vercel builds.

Use `prisma migrate dev` only for local migration authoring. Do not use
`prisma db push` against shared or production databases.

Prisma checks in CI:

- `prisma generate` ensures generated client imports remain valid.
- `prisma validate` checks schema validity.
- `next build` catches type and runtime integration issues at the Next/Prisma boundary.

Migration deployment is intentionally separate from normal PR/push CI. Run the
manual `Production Migrations` workflow with `confirm` set to `DEPLOY`; it uses
the `Production` environment and its `DATABASE_URL` secret. Run it from `main`
after the migration files are merged.

## CI

GitHub Actions workflow: `.github/workflows/ci.yml`.

Runs on pull requests and pushes to `main`, `feature/**`, `fix/**`, and
`chore/**`.

The workflow runs:

1. `bun install --frozen-lockfile`
2. `bun run prisma:generate`
3. `bun run prisma:validate`
4. `bun run format:check` for files changed in the PR/push
5. `bun run lint`
6. `bun run typecheck`
7. `bun test`
8. `bun run build`

This is intentionally more than lint/typecheck. Prisma client generation catches
schema/client drift, tests catch data helpers and UI behavior, changed-file
Prettier checks prevent new formatting drift without creating a one-time
format-only migration, and the production build catches Next.js route and
server-component issues.

## Deployment

The app is designed for Vercel.

Before production deploy:

1. Set production env vars in Vercel.
2. Confirm `DATABASE_URL` points at the production database in the Production environment.
3. Confirm `BETTER_AUTH_URL` is the deployed origin.
4. Confirm Telnyx webhook URL points at `https://<domain>/api/telnyx/webhooks`.
5. Confirm `TELNYX_PUBLIC_KEY` is configured.
6. Rotate any credential that was pasted into chat or logs before using it in production.

Vercel build command should use:

```bash
bun run vercel-build
```

The Vercel build command is enforced by `vercel.json`. Vercel builds generate
the Prisma client and build the Next.js app only; production database migrations
are deployed separately through GitHub Actions.

## Operational Runbooks

### Add A Practice

1. Create/authenticate the practice user.
2. Ensure `PracticeMembership` points to the correct `Practice`.
3. Add `PracticePhoneNumber` rows for every live office/call-center number.
4. Complete onboarding or import structured practice records.
5. Launch the practice once required sections are complete.

### Enable Call Center

1. Add/update `PracticePhoneNumber` rows for the practice-owned numbers.
2. Configure enabled `CallCenterNumber` rows and map every inbound number to one enabled queue.
3. Assign each portal user one enabled `CallCenterEndpoint` with a Telnyx credential and SIP username.
4. Add the user to each queue they may answer and associate the queue with the allowed locations.
5. Choose the practice default outbound number and confirm every enabled number has the intended inbound/outbound capability.
6. Confirm Telnyx sends signed callbacks to `POST /api/telnyx/webhooks`.
7. Sign into `/portal/app/call-center`, enable calling, and verify inbound Take/bridge plus outbound dialing.

### Backfill Abita Analytics

Use the importer when demo/history data needs to be refreshed from the sibling
analytics app:

```bash
bun scripts/import-abita-analytics.mjs
```

The importer reads `../call-analytics`, upserts `AgentCall` rows by `callId`,
and replaces estimated cost line items for imported calls.

### Set Practice Branding

```bash
bun scripts/set-practice-branding.mjs <user-email> <logo-url> [logo-alt] [primary-color] [accent-color] [mark-url]
```

For Abita:

```bash
bun scripts/set-practice-branding.mjs demo@acuity.local https://vy2zxpar1av2q12e.public.blob.vercel-storage.com/logo.png "Abita Eye Group logo" "#009ec3" "#123f7a"
```

## Security Boundaries

- Do not commit `.env`, `.env.local`, API keys, Telnyx credentials, or database URLs.
- Use bearer-token auth for LiveKit forward sync in production.
- Verify Telnyx webhook signatures in production.
- Keep practice-facing views operational and non-technical.
- Keep raw payloads, latency traces, token usage, audio, costs, and model/tool debugging under `/admin`.
- Treat phone-number ownership and explicit `practiceId` as the tenant boundary for call routing.

## Current Gaps

- Review worker output should write directly to `AgentCall.reviewResult`, `reviewStatus`, and `needsReview`.
- LiveKit forward sync should send explicit `practiceId` where possible.
- Add higher-level smoke tests for portal login, overview, call-center enablement, and a sample call ingestion payload.
- Add Playwright coverage before relying on CI for visual/regression confidence.

## Documentation

Planning, product, and research documents live in [`docs/`](docs/):

- [Customer Portal MVP](docs/CUSTOMER_PORTAL_MVP.md)
- [Customer Portal Product Vision and Next Steps](docs/CUSTOMER_PORTAL_PRODUCT_VISION_AND_NEXT_STEPS.md)
- [Practice Portal Data Pipeline](docs/PRACTICE_PORTAL_DATA_PIPELINE.md)
- [SEO Implementation Plan](docs/SEO_IMPLEMENTATION_PLAN.md)
- [SEO Research Plan](docs/SEO_RESEARCH_PLAN.md)
- [Implementation Notes](docs/implementation.md)
- [Research Notes](docs/research.md)
- [Site Testing Implementation](docs/site-testing-implementation.md)
