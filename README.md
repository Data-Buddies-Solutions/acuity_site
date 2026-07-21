# Acuity Health Platform

Private production application for Acuity Health's public website, practice
operations portal, internal command center, and communications infrastructure.

This repository is a Next.js modular monolith. It owns the customer-facing web
experience and the durable operational record for practices, AI receptionist
calls, staff call-center activity, tasks, documents, and text conversations.
Postgres is the source of truth; external providers deliver events and execute
effects, but they do not own application state.

## What Lives Here

| Surface              | Entry point        | Responsibility                                                                               |
| -------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| Public website       | `/`                | Marketing pages, specialty pages, insights, press, SEO, and lead generation                  |
| Practice portal      | `/portal/app`      | Onboarding, analytics, bookings, tasks, call center, texting, knowledge, and insurance rules |
| Admin command center | `/admin/practices` | Practice configuration, call diagnostics, costs, recordings, and document review             |
| Integration layer    | `/api/*`           | LiveKit ingestion, Telnyx webhooks, browser calling actions, and authenticated handoffs      |

The AI receptionist runtime and EHR integration do not run in this repository.
They send bounded results into this application through authenticated ingress.

## System Map

```mermaid
flowchart LR
  Visitor["Public visitor"] --> Website["Marketing and content pages"]
  Staff["Practice staff"] --> Portal["Practice portal"]
  Admin["Acuity operator"] --> CommandCenter["Admin command center"]

  LiveKit["LiveKit / AI receptionist"] --> AgentIngress["Authenticated call and task ingestion"]
  Telnyx["Telnyx"] --> ProviderIngress["Verified voice and SMS webhooks"]

  subgraph App["Next.js modular monolith"]
    Website
    Portal
    CommandCenter
    AgentIngress --> AgentOps["Agent call and task modules"]
    ProviderIngress --> Comms["Call-center and SMS modules"]
    Portal --> PracticeOps["Practice operations modules"]
    CommandCenter --> PracticeOps
  end

  AgentOps --> Database[("Postgres")]
  Comms --> Database
  PracticeOps --> Database
  Database --> Portal
  Database --> CommandCenter
  Comms --> Commands["Durable provider commands"] --> Telnyx
```

## Domain Language

The word "call" refers to two different records. Keep them separate.

| Term                     | Meaning                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `Practice`               | Tenant and ownership root for customer data and configuration                                   |
| `PracticeMembership`     | A user's practice role and all-location or selected-location access                             |
| `PracticePhoneNumber`    | The routing bridge from an external phone number to a practice and optional location            |
| `AgentCall`              | One AI receptionist conversation, including outcomes, transcript data, latency, usage, and cost |
| `AgentTask`              | Work created by the AI receptionist for practice staff                                          |
| `CallCenterCall`         | One logical staff call-center lifecycle, inbound or outbound                                    |
| `CallCenterCallLeg`      | One provider leg participating in a `CallCenterCall`, such as the patient or a browser agent    |
| `CallCenterAgentSession` | One user's leased browser connection, media readiness, and presence                             |
| `CallCenterTask`         | Follow-up work produced by the staff call-center lifecycle                                      |
| `SmsConversation`        | One patient conversation on a practice-owned SMS number                                         |

The complete persistence model is in
[`prisma/schema.prisma`](prisma/schema.prisma).

## Architecture

### Practice and access

Better Auth owns identity and sessions. Application access is derived from the
current `PracticeMembership`; selected-location memberships are enforced in
shared portal access helpers before data reaches a page or mutation. Practice
configuration—including locations, providers, phone numbers, branding,
knowledge, insurance rules, and call-center configuration—lives in Postgres.

Knowledge and insurance edits are revisioned. A submitted draft does not replace
the published revision until an Acuity admin approves it.

### AI receptionist operations

The AI runtime reports into three endpoints:

- `POST /api/livekit/calls` stores a normalized final `AgentCall`.
- `POST /api/livekit/tasks` stores an idempotent `AgentTask`.
- `POST /api/livekit/webhooks` stores signed lifecycle evidence and can create a
  minimal in-progress or failed call record when final sync is absent.

Practice resolution prefers an explicit `practiceId` and otherwise uses the
called office number through `PracticePhoneNumber`. The same `AgentCall` rows
power practice metrics, bookings, transcripts, and admin diagnostics.

### Staff call center

The call center has one server module and one canonical runtime for every
practice. HTTP handlers translate authenticated requests and signed callbacks;
they do not own call lifecycle state.

```mermaid
flowchart LR
  Telnyx["Telnyx callback"] --> Verify["Signature verification"]
  Verify --> Inbox["Durable, deduplicated webhook inbox"]
  Inbox --> Admit["Tenant and call admission"]
  Admit --> Project["Canonical projector"]
  Project --> State["Calls, legs, events, tasks, voicemail"]
  State --> Snapshot["Versioned operator snapshot"] --> Browser["Portal softphone"]
  Browser --> Action["Authenticated action"] --> State
  Project --> Outbox["Idempotent command outbox"] --> Telnyx
```

Important invariants:

- One logical call may have many provider legs and at most one bridged winner.
- A ringing or answered inbound leg does not make an agent busy; a
  provider-confirmed bridge does.
- The browser renders the versioned server snapshot and handles media. It is
  never the source of logical call truth.
- Provider callbacks are durably received, deduplicated, admitted, and projected
  before their committed commands are dispatched.
- Provider effects have idempotency keys and a bounded cron-driven recovery path.
- Authorization is scoped by practice, location, queue, user, session, and call.
- Terminal call and leg states never regress.

See the canonical
[`docs/architecture/call-center.md`](docs/architecture/call-center.md) for the
full model and [`docs/runbooks/call-center.md`](docs/runbooks/call-center.md) for
deployment and incident procedures.

### Two-way texting

The shared Telnyx webhook route identifies SMS events and sends them to the SMS
module. The module resolves the practice-owned number, stores idempotent message
state, tracks delivery and opt-out status, and enforces the current user's
location scope. Portal mutations start conversations, reply, mark read, change
status, or delete a conversation through authenticated routes.

### Public site and content

Public pages live beside the application in the App Router. Structured content
for insights, press releases, and specialties is kept in local TypeScript data
modules. `marketing/` contains strategy artifacts, not runtime code.

## Repository Map

| Path                                   | Owns                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`app/`](app/)                         | App Router pages, layouts, server actions, and UI                                                        |
| [`app/api/`](app/api/)                 | Thin HTTP adapters for auth, ingress, portal operations, and provider callbacks                          |
| [`components/`](components/)           | Shared UI primitives                                                                                     |
| [`lib/`](lib/)                         | Application modules for tenancy, analytics, onboarding, documents, tasks, pricing, and provider adapters |
| [`lib/call-center/`](lib/call-center/) | Call-center domain, application, authorization, and infrastructure modules                               |
| [`lib/sms/`](lib/sms/)                 | SMS phone normalization, webhook handling, access, and conversation operations                           |
| [`prisma/`](prisma/)                   | Schema, forward migrations, and migration contract tests                                                 |
| [`scripts/`](scripts/)                 | Explicit import, seed, branding, and formatting utilities                                                |
| [`docs/`](docs/)                       | Durable architecture, runbooks, and product contracts                                                    |
| [`public/`](public/)                   | Static site, portal, brand, and audio assets                                                             |
| [`marketing/`](marketing/)             | Non-runtime marketing strategy and planning documents                                                    |

### Where to make a change

| Change                             | Start here                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Public copy, SEO, or content       | `app/`, `app/insights/`, `app/press/`, `app/specialties/`                   |
| Portal navigation or page behavior | `app/portal/app/`                                                           |
| Practice or location access        | `lib/portal-access.ts`                                                      |
| Onboarding and practice records    | `lib/portal-state.ts`, `lib/practice-workspace.ts`                          |
| Metrics, bookings, or transcripts  | `lib/portal-overview.ts`, `lib/call-normalization.ts`                       |
| AI receptionist ingestion          | `lib/call-ingestion.ts`, `lib/task-ingestion.ts`, `lib/livekit-webhooks.ts` |
| Staff call-center behavior         | `lib/call-center/`                                                          |
| Two-way texting                    | `lib/sms/`                                                                  |
| Admin analytics and diagnostics    | `lib/admin-analytics.ts`, `app/admin/`                                      |
| Persistent state                   | `prisma/schema.prisma` and a new migration                                  |
| Deployment or release behavior     | `.github/workflows/`, `vercel.json`, and the relevant runbook               |

## Technology

- Next.js 16 App Router and React 19
- TypeScript 6
- Bun 1.3.11 in CI
- Postgres 16 in CI
- Prisma 7 with `@prisma/adapter-pg`
- Better Auth
- Telnyx Voice, WebRTC, and Messaging
- LiveKit webhook verification and call ingestion
- Tailwind CSS 4, Radix UI primitives, Recharts, and Lucide icons
- Vercel application hosting and scheduled command recovery

## Local Development

### Prerequisites

- Bun 1.3.11 or a compatible current Bun release
- A local Postgres database

### Start the application

```bash
cp .env.example .env.local
```

Create the local database, then keep the example connection string but append
the rollback-closure setting required to replay the complete migration history:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/acuity_portal?schema=public&options=-c%20acuity.call_center_rollback_closed%3Dtrue"
```

Save that value in `.env.local`, then install, migrate, and start:

```bash
bun install --frozen-lockfile
bunx prisma migrate deploy
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) for the public site or
[http://localhost:3000/portal](http://localhost:3000/portal) for portal login.
Set `PORTAL_ALLOW_SIGNUP="true"` only when you need to create a local account;
signup should remain disabled in deployed environments.

The minimum local configuration is documented in
[`.env.example`](.env.example). Never commit `.env.local` or real credentials.

### Environment groups

| Capability                          | Configuration                                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Database and auth                   | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PORTAL_ALLOW_SIGNUP`                                    |
| Admin access                        | `ADMIN_EMAILS` or `ACUITY_ADMIN_EMAILS`                                                                           |
| Final AI call/task sync             | `LIVEKIT_FORWARD_SYNC_SECRET`; `WEBHOOK_SECRET` remains a legacy fallback                                         |
| Signed LiveKit webhooks             | `LIVEKIT_WEBHOOK_API_KEY`, `LIVEKIT_WEBHOOK_API_SECRET`, or their `LIVEKIT_API_*` fallbacks                       |
| Telnyx API and webhook verification | `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`                                                                             |
| Provider-command recovery           | `CRON_SECRET`                                                                                                     |
| Direct handoff                      | `CALL_CENTER_DIRECT_HANDOFF_SIP_URI`, `CALL_CENTER_HANDOFF_ABITA_PRACTICE_ID`, `CALL_CENTER_HANDOFF_ABITA_SECRET` |

Queue, number, endpoint, provider credential ID, location, membership, and
caller-ID behavior belong in Postgres rather than environment variables.
`TELNYX_ALLOW_UNVERIFIED_WEBHOOKS` and `LIVEKIT_ALLOW_UNVERIFIED_WEBHOOKS` are
local-development escape hatches and are rejected in production.

## Commands

| Command                   | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `bun run dev`             | Start the local Next.js server                                   |
| `bun run check`           | Validate Prisma, lint, typecheck, and run all Bun tests          |
| `bun run ci`              | Run the complete local CI contract, including a production build |
| `bun run build`           | Generate Prisma Client and build with Next.js webpack            |
| `bun run format`          | Format the repository and Prisma schema                          |
| `bun run format:check`    | Check formatting for the current change set                      |
| `bun run prisma:generate` | Regenerate the client in `generated/prisma`                      |
| `bun run prisma:validate` | Validate the Prisma schema                                       |
| `bun run prisma:migrate`  | Author and apply a local development migration                   |
| `bun run prisma:studio`   | Open Prisma Studio                                               |

Tests live next to their modules or under `__tests__`. The CI migration job also
replays the complete migration history against Postgres and runs the
database-backed call-center concurrency and ordering tests.

## Database and Migrations

`prisma/schema.prisma` is the persistence contract. Every shared schema change
requires a committed migration under `prisma/migrations/`.

- Use `bun run prisma:migrate` to author migrations locally.
- Use `bunx prisma migrate deploy` to apply committed migrations without
  authoring new ones.
- Never use `prisma db push` against a shared or production database.
- Never run production migrations from a Vercel build.

Production migrations run separately through
[`.github/workflows/production-migrations.yml`](.github/workflows/production-migrations.yml).
The workflow runs only from `main` when manually invoked with `confirm=DEPLOY`.

## Delivery

Pull requests run the matrix in [`.github/workflows/ci.yml`](.github/workflows/ci.yml):
Prisma validation, changed-file formatting, lint, typecheck, tests, production
build, and clean Postgres migration replay.

The application deploys to Vercel with `bun run vercel-build`. `vercel.json`
also invokes `/api/internal/call-center/provider-commands` every minute so
committed provider commands survive interrupted immediate dispatch.

For call-center changes, follow the production verification and incident
contract in [`docs/runbooks/call-center.md`](docs/runbooks/call-center.md).

## Security Boundaries

- Do not commit secrets, database URLs, provider credentials, recordings, raw
  payloads, or patient data.
- Authenticate every practice operation from the server-side session; do not
  trust a client-supplied practice, location, queue, user, or call owner.
- Apply location scope before querying or mutating practice data.
- Verify LiveKit and Telnyx webhook signatures outside explicitly enabled local
  development.
- Keep raw payloads, recordings, latency traces, token usage, costs, and model or
  tool diagnostics in the admin surface.
- Log stable identifiers and categorical errors rather than credentials, raw
  provider payloads, transcripts, or patient details.
- Preserve webhook, command, call, leg, and event rows during incident response;
  they are the evidence needed to recover safely.

## Documentation

Read documents according to the question being answered:

| Document                                                                                             | Authority                                                   |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [`prisma/schema.prisma`](prisma/schema.prisma)                                                       | Current persisted model                                     |
| [`docs/architecture/call-center.md`](docs/architecture/call-center.md)                               | Canonical call-center runtime and invariants                |
| [`docs/runbooks/call-center.md`](docs/runbooks/call-center.md)                                       | Call-center deployment, verification, and incident response |
| [`docs/architecture/call-center-agent-sessions.md`](docs/architecture/call-center-agent-sessions.md) | Browser lease and media-readiness contract                  |
| [`docs/architecture/data-ownership.md`](docs/architecture/data-ownership.md)                         | Data ownership and authenticated ingress boundaries         |
| [`docs/product/practice-portal.md`](docs/product/practice-portal.md)                                 | Durable practice-portal product contract                    |

Code, schema, current workflows, and documents explicitly marked canonical take
precedence. Track current work in GitHub issues and pull requests rather than
documentation backlogs.
