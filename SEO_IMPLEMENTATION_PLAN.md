# SEO Implementation Plan

## Objective 

- Launch a fully SEO-optimized version of `agent-house-landing-page` that can rank for high-intent AI automation queries, deliver Core Web Vitals in the “Good” range, and build topical authority within 6 months.
- Translate the strategic recommendations in `SEO_RESEARCH_PLAN.md` into concrete development, content, and operational tasks for this Next.js 15 landing page.

## Current Baseline (Oct 2025)

- Single-page marketing site served from `app/page.tsx`; global shell in `app/layout.tsx` with basic metadata, sitemap, and robots configured.
- Content limited to hero, problems, features, CTA, and footer sections with ~300–350 words.
- No structured data, canonical tag, FAQ content, testimonials, case studies, or internal navigation beyond anchor links.
- No analytics, Search Console verification, or performance benchmarking committed to the repo.

## Technical SEO Implementation

### 1. Metadata & Tag Hygiene

- **Primary Goal:** Align meta tags with target keywords and prevent duplicate-content issues.
- Tasks:
  - Update `app/layout.tsx` metadata to focus on primary transactional keyword combinations (e.g., “AI automation for small business”).
  - Add a `metadataBase` and `alternates: { canonical: "https://databuddiessolutions.com/" }` block in `app/layout.tsx`.
  - Expand `keywords` array to incorporate top long-tail opportunities (`hire AI automation consultant`, `affordable AI automation services`, etc.).
  - Author unique meta descriptions for each future page/section when they exist; maintain 150–160 characters with CTA.
  - Generate a custom OG image (1200 × 630) and store in `public/og-default.jpg`; reference in `openGraph.images` and `twitter.images`.

### 2. Structured Data (Schema.org)

- Implement Organization + ProfessionalService schema JSON-LD in `app/layout.tsx` using `<script type="application/ld+json">`.
- Add FAQ schema once FAQ section is built (see Content Expansion) in a dedicated component (e.g., `app/components/FAQ.tsx`) and render JSON-LD near the component or via a dedicated utility module.
- For future case studies or testimonials, plan Testimonial schema blocks to highlight social proof.
- Maintain a shared utility (e.g., `app/lib/structured-data.ts`) to keep schema definitions typed and reusable.

### 3. Media Optimization

- Compress hero image to <200 KB using lossless WebP and update `app/components/Hero.tsx` to serve via `next/image` with `sizes` attribute.
- Supply descriptive `alt` attributes for all imagery (already present on hero; extend to any new visuals).
- Add `loading="lazy"` to non-critical images and `priority` only for fold visuals.

### 4. Crawlability & Indexation

- Confirm `app/sitemap.ts` outputs target URLs (homepage + future /blog, /case-studies, etc.) and configure regeneration triggers.
- Keep `robots.ts` updated to reference sitemap and allow discovery of new sections.
- Validate `robots.txt`, `sitemap.xml`, and `llms.txt` are deployed by running `npm run build && npm run start` locally and checking responses with `curl` before deployments.
- Add Search Console verification token to `metadata.verification.google`.
- Submit sitemap to Google/Bing once new content is live.

### 5. Performance & Core Web Vitals

- Set up automated Lighthouse audits (e.g., GitHub Action or local `npm run lint && npm run lighthouse` script) focusing on LCP, CLS, TBT.
- Implement font loading optimization (system fonts already in use; if introducing custom fonts, preload or self-host).
- Leverage Next.js Route Handlers for edge caching; configure Vercel (or hosting platform) to enable HTTP/2, compression, and caching headers.
- For future interactive components, use React Server Components where possible and defer hydration for client-only features with `use client`.

## Content & On-Page Experience

### 1. Landing Page Content Enhancements

- Expand hero copy to include keyword-rich subtext (e.g., “AI automation for small businesses”).
- Introduce a benefits grid tying solutions to target personas (operations managers, solo founders, etc.).
- Add social proof: testimonials, client logos, quick stats (e.g., “2x faster lead follow-up”).
- Create a detailed “How It Works” section and an “Industries Served” segment to widen keyword coverage.
- Implement an FAQ section (8–10 questions from research plan) using semantic HTML (`<dl>` or `<details>`).
- Add a prominent contact form or calendar embed to capture conversions and add more indexable content.

### 2. Future Content Architecture

- Draft new routes using the App Router: `/blog`, `/blog/[slug]`, `/case-studies/[slug]`, `/services/[slug]`.
- For each new page: ensure unique H1, introduction, internal links, and structured headings (H2/H3) that map to keyword clusters.
- Implement breadcrumbs once multiple pages exist (`app/components/Breadcrumbs.tsx` with schema).

### 3. Internal Linking Strategy

- Enhance navigation with anchor links to new sections and add a sticky secondary nav once content expands.
- Within new blog posts and case studies, link back to core service pages and relevant CTAs.
- Create footer quick links (Services, Resources, Blog, Contact) to reinforce crawl paths.

## Analytics, Tracking & Reporting

- Install Google Analytics 4 via `app/providers/AnalyticsProvider.tsx` or use Vercel Analytics; ensure consent banner compliance if required.
- Configure Google Search Console and Bing Webmaster Tools; document verification in `/docs/seo/verification.md`.
- Set up conversion tracking events (CTA clicks, form submissions) using GA4 or server-side tracking via Next.js API routes.
- Maintain a monthly SEO dashboard (Looker Studio or Sheets) to monitor rankings, traffic, conversions, and backlink growth.

## Authority & Off-Page Strategy

- Build a backlink outreach pipeline:
  - Guest posts on small business and AI automation blogs.
  - Partnerships with local business associations and tech communities.
  - Repurpose case studies into PDF downloads for shareable assets.
- Encourage satisfied clients to leave reviews on G2, Clutch, or LinkedIn; cross-link to site.
- Leverage thought leadership via LinkedIn posts and embed highlights on the blog.

## Delivery Roadmap

| Week | Focus                  | Key Deliverables                                                                              |
| ---- | ---------------------- | --------------------------------------------------------------------------------------------- |
| 1    | Technical foundation   | Metadata overhaul, canonical tag, structured data, image compression, Search Console setup    |
| 2    | Landing page content   | Expand copy, add new sections (Benefits, How It Works, FAQs), integrate FAQ schema            |
| 3    | Conversion & analytics | Add contact form/calendar embed, GA4 integration, conversion tracking                         |
| 4    | Performance tuning     | Lighthouse baseline, image optimization, caching strategy, Core Web Vitals fixes              |
| 5–8  | Content expansion      | Launch blog & case study templates, publish first 4 articles, create downloadable lead magnet |
| 9+   | Authority building     | Backlink outreach, partnerships, quarterly SEO performance reviews                            |

## Quality Assurance Checklist

- Validate HTML semantics and heading hierarchy per page with aXe or Lighthouse.
- Run `npm run lint` and automated tests before each deployment.
- Spot-check structured data with Google’s Rich Results Test after every schema change.
- Review site on mobile and desktop for responsive issues whenever new sections are added.
- Monitor uptime and performance via hosting provider dashboards.

## Continuous Improvement

- Schedule monthly audits to review Core Web Vitals, keyword rankings, and search console coverage.
- Iterate on copy and CTAs based on engagement metrics (scroll depth, CTR, conversion rate).
- Refresh top-performing content quarterly with new data, visuals, and internal links.
- Document all SEO updates, experiments, and learnings in `/docs/seo/changelog.md` to maintain institutional knowledge.
