# Practice Portal Product Contract

Last reviewed: 2026-07-21

## Purpose

The practice portal is the operating console for Acuity's AI receptionist and
staff communication workflows. Its users are practice owners, office managers,
front-desk staff, and multi-location operators. It is not a patient portal.

The portal should help a practice teach Acuity how its front desk works, operate
daily call and messaging workflows, and review outcomes that need staff action.

## Product Principles

1. Keep onboarding short and confidence-building.
2. Make daily operational work denser and more prominent than configuration.
3. Present practice knowledge as readable, structured operating material.
4. Make location scope visible without burdening single-location practices.
5. Keep technical diagnostics, raw payloads, latency, and provider evidence in
   the internal admin command center.
6. Make every save, submission, and action produce an obvious durable result.
7. Treat knowledge and insurance rules as reviewed, versioned documents.

## Current Surfaces

- Onboarding captures practice basics, locations, providers, knowledge, and
  insurance rules.
- Overview translates call data into practice-facing operational metrics.
- Bookings exposes appointments extracted from AI receptionist calls.
- Tasks and call-center follow-up expose work that needs staff action.
- Call Center owns browser calling, inbound offers, outbound dialing, voicemail,
  history, and same-location transfer.
- Two-way texting owns practice-number inboxes and patient conversations.
- Knowledge Base and Insurance Crosswalk support staff drafts and internal
  approval before publication.

Route details and implementation entry points belong in `README.md`. Current
work and unresolved product decisions belong in GitHub issues, not this file.

## Boundaries

- Patients continue to interact through phone, SMS, forms, and secure links.
- The portal does not own the AI receptionist runtime or EHR integration.
- The portal database owns practice configuration, operational records, review
  state, and staff-visible outcomes.
- Internal admin pages may expose technical evidence that customer-facing pages
  deliberately omit.

## Success

The product succeeds when practices can configure their operating knowledge,
see what Acuity did, identify work needing intervention, and complete routine
staff workflows without engineering support.
