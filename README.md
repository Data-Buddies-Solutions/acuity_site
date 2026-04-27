# Acuity Health Website

A Next.js marketing site for Acuity Health, focused on patient access and engagement for ophthalmology and optometry practices.

## Getting Started

First, install dependencies:

```bash
bun install
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Build

To create a production build:

```bash
bun run build
bun run start
```

## Practice Portal

Portal routes:

- `/portal` - staff login
- `/portal/app` - redirects launched practices to overview and setup practices to onboarding
- `/portal/app/overview` - customer-facing operational summary
- `/admin/practices` - internal practice command center

Call data should land in the portal through `POST /api/livekit/calls`. Historical/demo data can be backfilled from the sibling `call-analytics` project with `scripts/import-abita-analytics.mjs`, but the target architecture is direct agent-to-portal forward sync. The ingest route accepts unauthenticated posts when no webhook secret is configured, matching the current `call-analytics` migration behavior; setting `LIVEKIT_FORWARD_SYNC_SECRET` or `WEBHOOK_SECRET` turns bearer-token auth on. See `PRACTICE_PORTAL_DATA_PIPELINE.md`.

Admin analytics cost estimates use the shared calculator in `lib/pricing.ts` for LiveKit, Telnyx SIP inbound, AssemblyAI STT, Baseten GLM-4.7 token usage, and ElevenLabs Flash TTS.

Useful environment variables:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `LIVEKIT_FORWARD_SYNC_SECRET` or `WEBHOOK_SECRET` for authenticated call ingestion
- `ADMIN_EMAILS` or `ACUITY_ADMIN_EMAILS`

## Deploy on Vercel

The easiest way to deploy this Next.js app is to use the [Vercel Platform](https://vercel.com/new).

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Next.js App Router
- Prisma 7
- Better Auth
- Bun

## Structure

- `/app` - Next.js App Router pages and components
- `/app/components` - React components for homepage sections, navigation, and shared UI
- `/public` - Static assets (images, llms.txt)
- `/app/globals.css` - Global styles

## SEO

- Metadata configured in `app/layout.tsx`
- Dynamic sitemap at `app/sitemap.ts`
- Robots.txt at `app/robots.ts`
- LLM instructions at `public/llms.txt`

## Contact

- **Email**: kyle@acuityhealth.io
- **Book a Demo**: [Cal.com scheduling link](https://cal.com/kyle-shechtman-acuity/30min)
