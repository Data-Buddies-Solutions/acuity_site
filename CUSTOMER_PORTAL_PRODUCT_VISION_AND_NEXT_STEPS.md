# Acuity Practice Portal Product Vision and Next Steps

## Product Vision

The practice portal should feel like the operating console for an AI receptionist, not a generic admin dashboard. The product should help a practice teach Acuity how the front desk works, then maintain that operating knowledge over time as locations, providers, insurance rules, and patient workflows change.

The core experience should stay calm, premium, and direct:

- Onboarding collects only the information needed to train the receptionist.
- The dashboard is read-first and operational, not a continuation of setup.
- Practice documents are structured playbooks, not raw markdown blobs.
- Editing should be available, but the default state should feel polished and reviewable.
- Multi-location practices should be first-class, with location-specific providers, insurance rules, and knowledge.

## Current Product Shape

### Onboarding

The onboarding wizard now focuses on:

- Practice basics and multiple locations
- Providers assigned to locations
- Insurance rules with optional location-specific overrides
- Knowledge base with optional location-specific scripts and rules
- Review and submit

The website scan step was removed from the primary onboarding flow for simplicity.

### Preparing Screen

After submit, the practice sees a full-screen premium preparing state. The animated seven-dot mark represents the AI receptionist being trained on practice information before the user lands on the dashboard.

### Portal Shell

The live portal uses:

- Sticky desktop sidebar
- Primary operations navigation
- Collapsible Documents section
- Quiet account footer with practice name, email, and sign out
- Focused onboarding layout without the full app sidebar

### Documents

Documents are now read-first structured pages:

- Practice Information
- Knowledge Base
- Insurance Crosswalk

Knowledge Base and Insurance Crosswalk keep structured edit forms behind an edit mode. Practice Information also supports post-launch editing for locations and providers.

## Product Principles

1. Keep onboarding short and confidence-building.
2. Keep operational pages dense enough for repeated use.
3. Keep documents readable by humans and structured for the AI.
4. Avoid raw markdown as the source of truth for clinical or operational behavior.
5. Make location differences obvious without making single-location practices do extra work.
6. Treat insurance rules and knowledge as living documents.
7. Make every submit/save land somewhere obvious.

## Near-Term Next Steps

### 1. Strengthen Data Model and Persistence

- Move fully away from cookie-backed draft storage for authenticated DB-backed accounts.
- Add explicit tests for multi-location save flows.
- Add explicit tests for provider add/remove behavior.
- Add tests for location-specific insurance and knowledge overrides.
- Add tests for post-launch document edit redirects.

### 2. Improve Practice Information Editing

- Consider separating edit modes into tabs or sections:
  - Locations
  - Providers
  - Account profile
- Add clearer empty states for practices with no providers.
- Consider provider-to-multiple-location relationships if practices need doctors at more than one location.

### 3. Make Documents More Useful

- Add "last updated" metadata per document.
- Add section-level edit buttons.
- Add a simple review status:
  - Draft
  - Reviewed
  - Needs update
- Add an internal audit trail for changes that affect AI behavior.

### 4. Dashboard Evolution

- Make Overview an operations summary, not a setup status page.
- Surface recent calls, unresolved handoffs, callbacks, and patient messages when integrations are live.
- Add a "Needs attention" queue as the primary daily workflow.
- Keep Documents in the sidebar as a secondary reference area.

### 5. Launch Readiness

- Add mobile visual QA for onboarding and document pages.
- Add reduced-motion support for the preparing animation.
- Add Playwright smoke tests for:
  - Onboarding completion
  - Submit to preparing
  - Preparing to overview
  - Document edit/save
  - Sidebar Documents collapse

## Medium-Term Product Direction

### AI Receptionist Training Center

Documents should become the practice's training center for the AI receptionist. Over time, each section can map to runtime behavior:

- What Acuity can answer directly
- What Acuity should clarify
- What Acuity should never promise
- What Acuity should transfer to staff
- What varies by location
- What varies by provider
- What varies by insurance plan

### Operational Intelligence

Once real call/text data is connected, the portal should show:

- Why calls were transferred
- Which knowledge gaps caused handoffs
- Which insurance questions are creating friction
- Which locations/providers generate the most exceptions
- Suggested document updates based on real conversations

### Practice Change Management

The portal should eventually support a lightweight approval workflow:

- Staff proposes knowledge/rule changes
- Admin reviews and approves
- Approved changes become available to the AI receptionist
- Prior versions remain auditable

## Technical Priorities Before Wider Use

- Add test coverage around server actions and persistence.
- Confirm Prisma text fields and JSON structures are sufficient for long documents.
- Add seed/demo data for a multi-location ophthalmology practice.
- Add a local smoke-test script that can exercise the portal without manual clicking.
- Review auth and account ownership assumptions before inviting real practices.

## Open Product Questions

- Should providers be able to belong to multiple locations?
- Should insurance rules be per practice, per location, or per plan plus location?
- Should Practice Information have its own edit sections instead of one combined page?
- Should document review be required after every edit before the AI uses the change?
- Should the portal distinguish "submitted setup" from "AI live in production"?
