# Site Testing Implementation Plan

## Objective

Establish automated site-level testing that validates critical user journeys (navigation, content, and key conversions) so regressions are caught before deployment.

## Tooling

- Playwright for browser-based end-to-end tests (integrates well with Next.js and supports multiple browsers).
- Testing Library + Vitest already present for component-level coverage; keep using for unit checks.

## Scope & Test Targets

- **Smoke**: Home page renders, main sections visible, no console errors.
- **Navigation**: Header links (including FAQ and Blog) route correctly; mobile menu works on small viewports.
- **Conversion CTA**: “Book a Strategy Call” buttons open the expected external link.
- **Forms / Interactions**: Validate any lead capture forms or interactive components once available.

## Implementation Steps

1. **Install Playwright**
   - Add `@playwright/test` and run `npx playwright install` to fetch browser binaries.
   - Create a dedicated npm script (`test:e2e`) for running the suite locally and in CI.
2. **Set up Playwright config**
   - Create `playwright.config.ts` targeting Chromium, Firefox, and WebKit (if desired) with a base URL (e.g., `http://localhost:3000`).
   - Define project-level settings for desktop and mobile viewports; include trace/ screenshot capture on failures.
3. **Author smoke & navigation tests**
   - Create tests under `tests/e2e/` that start the Next.js dev server (use Playwright test fixtures) and verify:
     - Home page loads, hero text visible, no severe console errors.
     - Header nav (desktop and mobile hamburger) navigates to sections/pages, overlay closes as expected.
     - Footer or other global elements render correctly.
4. **Cover conversion pathways**
   - Add a test that clicks the “Book a Strategy Call” CTA and asserts the outgoing URL.
   - For any inline forms, submit happy-path data and confirm success feedback (mock network if needed).
5. **Integrate with CI**
   - Extend GitHub Actions (or chosen CI) workflow to install Playwright dependencies, build the site, and run `npm run test:e2e`.
   - Store traces/screenshots as artifacts for debugging failures.
6. **Document usage**
   - Update `README.md` with instructions on running Playwright tests locally, including required commands and troubleshooting tips.

## Verification

- Run `npm run test` (unit) + `npm run test:e2e` (Playwright) locally; ensure both pass.
- Perform a manual sanity check in production-like environment after significant UI changes until coverage is complete.
- Monitor CI runs for stability; investigate flaky tests promptly.
