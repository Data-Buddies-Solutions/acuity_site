# Customer Portal MVP Spec  

## Objective

Build a staff-facing customer portal for Acuity Health that lets each practice configure its workflows, manage office-specific knowledge, and access the core product experience after onboarding.

This should not be positioned as a patient portal. The primary user is the practice team: office managers, front-desk staff, and admins. Patients should continue to interact through phone, SMS, forms, and secure links without needing to create accounts.

## Product Thesis

Acuity's strongest product direction is not "add a login page." It is "give each practice a workspace where Acuity learns the office once, then uses that knowledge to power calls, intake, texting, routing, and analytics."

The moat is the office-specific workflow layer:

- Insurance rules
- Scheduling logic
- Provider and location context
- FAQs and scripts
- Transfer and escalation rules
- Appointment prep and intake requirements

Generic texting and analytics are already common in the market. The differentiated product is ophthalmology-specific operational intelligence tied directly to automation and reporting.

## MVP Positioning

Position the portal as:

- Set up your practice once
- Acuity learns your office
- Then Acuity runs calls, texting, intake, and reporting from that knowledge

Avoid positioning it as:

- "Just a login page"
- "Just another messaging dashboard"
- "A patient app"

## Primary Users

- Practice owner
- Office manager
- Front-desk lead
- Multi-location operations manager

## Secondary Users

- Support / implementation team
- Internal Acuity admin users

## Non-Goals for MVP

- Patient accounts
- Full patient self-service portal
- Deep EMR write-back for every workflow
- Enterprise permissions matrix
- Full billing / subscription management
- Native mobile app

## MVP Outcomes

The MVP should let a practice:

- Log in securely
- Complete onboarding in under 30 minutes
- Configure office-specific knowledge without engineering help
- Review calls, messages, and unresolved issues
- See simple operational analytics
- Understand what Acuity is doing and where intervention is needed

## Core Product Areas

1. Authentication and organization workspace
2. Guided onboarding
3. Office knowledge base
4. Inbox and call review
5. Analytics and visibility

## MVP Information Architecture

### 1. Login

Route:

- `/login`

Purpose:

- Secure staff access to the portal

Requirements:

- Email/password login
- Forgot password flow
- Session persistence
- Redirect authenticated users into the workspace

### 2. Onboarding

Routes:

- `/onboarding`
- `/onboarding/practice`
- `/onboarding/insurance-intake`
- `/onboarding/knowledge`
- `/onboarding/review`

Purpose:

- Capture the minimum practice information needed for Acuity to operate correctly

Sections:

- Practice profile
- Locations and phone numbers
- Business hours and after-hours rules
- Providers
- Appointment types
- Accepted insurance plans
- Intake requirements
- Transfer and escalation rules
- Office FAQs and scripts

Success criteria:

- A new customer can complete setup without support for the common case
- Every answer maps to a usable workflow input

### 3. Knowledge Base

Route:

- `/knowledge-base`

Purpose:

- Manage office-specific knowledge that powers AI receptionist behavior and staff visibility

Content types:

- FAQs
- Appointment prep instructions
- Insurance notes
- Provider notes
- Transfer rules
- Escalation criteria
- Office policies
- Call scripts

MVP capabilities:

- Create article
- Edit article
- Archive article
- Search and filter
- Tag by location / provider / category

### 4. Inbox

Route:

- `/inbox`

Purpose:

- Give staff one place to review call outcomes, text conversations, and follow-up items

Views:

- All conversations
- Missed calls
- Open issues
- Needs human review
- Texting threads

MVP capabilities:

- View transcript
- View call summary
- View conversation history
- Mark resolved
- Assign follow-up status
- Filter by location, date, issue type

### 5. Analytics

Route:

- `/analytics`

Purpose:

- Show what is happening operationally across the front desk

MVP metrics:

- Total inbound calls
- Answered vs missed calls
- After-hours call volume
- Appointment booking count
- Transfer rate
- Text response rate
- Open issue count
- Top call reasons

Filters:

- Date range
- Location
- Provider

## First 6 Screens to Build

1. `/login`
2. `/onboarding/practice`
3. `/onboarding/insurance-intake`
4. `/knowledge-base`
5. `/inbox`
6. `/analytics`

## Recommended Onboarding Flow

### Step 1: Practice Setup

Capture:

- Practice name
- Number of locations
- Location names
- Main phone numbers
- Business hours
- After-hours rules

### Step 2: Clinical / Scheduling Context

Capture:

- Providers
- Appointment types
- Scheduling rules
- Reschedule / cancellation rules
- Transfer logic

### Step 3: Insurance and Intake

Capture:

- Accepted plans
- Insurance verification rules
- Required documents
- Intake questions
- New vs existing patient rules

### Step 4: Knowledge and Scripts

Capture:

- FAQs
- Office-specific edge cases
- Preparation instructions
- Human escalation triggers
- "Never say / always say" guidance

### Step 5: Review and Launch

Show:

- Configuration summary
- Missing items
- Recommended next actions
- Portal status: ready / partial / needs review

## Data Model

### Core Entities

- `Organization`
- `Location`
- `User`
- `Membership`
- `Provider`
- `AppointmentType`
- `InsurancePlan`
- `KnowledgeArticle`
- `WorkflowRule`
- `Conversation`
- `Message`
- `CallTranscript`
- `AnalyticsEvent`

### Suggested Entity Notes

#### Organization

- name
- slug
- status
- onboardingStatus

#### Location

- organizationId
- name
- phoneNumber
- timezone
- businessHours

#### User

- email
- name
- role

#### Membership

- userId
- organizationId
- role

#### Provider

- organizationId
- locationId
- name
- specialty
- active

#### AppointmentType

- organizationId
- name
- duration
- schedulingRules
- prepInstructions

#### InsurancePlan

- organizationId
- payerName
- accepted
- notes

#### KnowledgeArticle

- organizationId
- locationId nullable
- providerId nullable
- category
- title
- content
- status

#### WorkflowRule

- organizationId
- type
- condition
- action
- active

#### Conversation

- organizationId
- channel
- locationId
- status
- outcome
- startedAt

#### Message

- conversationId
- direction
- body
- sentAt

#### CallTranscript

- conversationId
- summary
- transcript
- disposition
- escalationFlag

#### AnalyticsEvent

- organizationId
- locationId
- eventType
- value
- occurredAt

## Role Model for MVP

### Admin

- Manage organization settings
- Manage onboarding
- Manage knowledge base
- View inbox and analytics

### Manager

- Edit operations content
- Review inbox
- View analytics

### Staff

- Review inbox
- Read knowledge base

Keep permissions simple in the MVP. Over-designing RBAC early will slow the product down.

## User Stories

### Practice Admin

As a practice admin, I want to configure my locations, hours, insurance rules, and office knowledge so Acuity handles calls correctly without custom engineering work.

### Office Manager

As an office manager, I want to see conversations, missed calls, and transcripts in one place so I can spot issues quickly and improve performance.

### Front-Desk Lead

As a front-desk lead, I want office answers and escalation guidance available in one workspace so I can trust what Acuity is saying and know when to step in.

## Success Metrics

- Time to complete onboarding
- Percentage of customers who finish onboarding without support
- Knowledge base completion rate
- Number of unresolved conversations per practice
- Missed call rate
- Booking conversion rate from inbound calls
- Text response rate
- Weekly active customer accounts

## MVP Build Sequence

### Phase 1

- Authentication
- Organization model
- Basic onboarding wizard
- Knowledge base CRUD

### Phase 2

- Inbox
- Call transcript viewer
- Simple conversation statuses
- Basic analytics dashboard

### Phase 3

- Workflow rules
- Texting management improvements
- Multi-location filters
- Better reporting

### Phase 4

- Deeper integrations
- Expanded role permissions
- Customer health / QA tooling
- Enterprise controls

## Product Risks

### Risk 1: Overbuilding the portal before core automation value is strong

Mitigation:

- Ship the workspace only around workflows that directly improve calls, intake, texting, and reporting

### Risk 2: Turning onboarding into a long questionnaire

Mitigation:

- Keep onboarding progressive
- Show immediate value after each section
- Pre-fill defaults where possible

### Risk 3: Competing on generic features

Mitigation:

- Focus the portal on ophthalmology-specific workflows and operational context

### Risk 4: Forcing patient login

Mitigation:

- Keep patient interactions link-based, SMS-based, phone-based, and low-friction

## UX Principles

- Staff-first, not patient-first
- Setup should feel guided, not bureaucratic
- Every field should have a clear downstream use
- Analytics should explain outcomes, not just display numbers
- Knowledge editing should be simple enough for non-technical office staff

## Recommended Tech Direction

- Keep the portal in the existing Next.js app
- Use Better Auth for staff login if you want consistency with the pattern already used in `onlinedoctornote`
- Start with a clean multi-tenant organization model
- Keep the first analytics layer event-based and simple

## Summary

The right product move is not merely adding login. The right move is creating a customer workspace where each practice teaches Acuity how the office works, then gets visibility into calls, texting, intake, and performance.

The MVP should prove three things:

- Customers can onboard quickly
- Acuity can use office-specific knowledge in production workflows
- Staff can see enough operational visibility to trust and improve the system
