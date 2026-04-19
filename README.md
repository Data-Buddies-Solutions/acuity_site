# Acuity Health Website

A Next.js marketing site for Acuity Health, focused on patient access and engagement for ophthalmology and optometry practices.

## Getting Started

First, install dependencies:

```bash
npm install
```

Then, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Build

To create a production build:

```bash
npx next build --webpack
npm start
```

## Deploy on Vercel

The easiest way to deploy this Next.js app is to use the [Vercel Platform](https://vercel.com/new).

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Next.js App Router

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
