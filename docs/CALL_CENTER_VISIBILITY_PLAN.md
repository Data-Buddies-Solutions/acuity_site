# Call Center Visibility Plan

Status: implemented legacy UX reference. `CALL_CENTER_PLATFORM_SPEC.md` now
owns call-center architecture, migration sequencing, and legacy deletion.

## Scope

This plan covers the first four implementation items for the Hollywood / Sweetwater call-center visibility work:

1. Fix transferred calls that can disappear from Recents.
2. Replace capped Missed / Activity / Recents lists with a paginated history.
3. Add a caller timeline.
4. Add lightweight post-call disposition.

Out of scope for this first pass:

- Full manager live-operations dashboard.
- Hollywood / Sweetwater top-level split. The shared `callcenter@abitaeye.com` workflow should stay combined.
- Due dates and task ownership. Follow-up tracking is unresolved/resolved only.

## Product Decisions

- The external call center shares `callcenter@abitaeye.com`, but each individual has a station in the app. Attribution should use the station first, with user/browser metadata when available.
- Because the login is shared, staff should explicitly check in to a station before handling calls. Do not silently default to the first station for this workflow.
- Remember the last selected station per browser, but show a clear `Checked in as <station>` state so staff can catch mistakes.
- Notes and dispositions can be visible to all users with portal access.
- Keep the Hollywood / Sweetwater call-center view combined. Do not add Hollywood / Sweetwater top-level tabs for this workflow.
- Use a command-center model: the call-center page is the live operational surface, not a full analytics dashboard.
- Live work should stay visible in one place, while deeper caller history should be one click away.
- Dispositions should stay simple:
  - Resolved
  - Callback needed
  - Follow-up required
  - Wrong number
  - Other
- Best-practice recommendation: require a one-click disposition only after a staff-handled completed call, with notes optional. This keeps reporting clean without slowing staff down. For `Other`, show an optional note field but do not block submission.
- `Callback needed` and `Follow-up required` should remain unresolved until manually resolved.
- `Resolved`, `Wrong number`, and `Other` can be treated as resolved by default unless staff marks them unresolved.
- Timeline should include texts if the existing SMS records can be queried by normalized phone number without a major integration. If that is not straightforward, ship calls/voicemails/dispositions first and add texts as the next iteration.

## Command Center UX Direction

The call-center page should feel like a command center for the current shift. It should answer the operational questions immediately, then let users drill into a caller when they need more context.

The first screen should answer:

- Who is calling right now?
- Who is handling them?
- What still needs follow-up?
- What happened with this caller before?

Guiding principle:

- Do not expand every caller's full history directly inside the main call-center frame.
- Keep the live work visible on the main page.
- Open caller history progressively:
  - Quick review: right-side caller timeline drawer on desktop.
  - Focused review: full caller history page when staff needs a deeper audit.

Recommended information architecture:

1. `Call Center Command Center`
   - Main route: existing call-center page.
   - Purpose: live queue, unresolved work, call handling, post-call disposition, and paginated history.
2. `Caller Timeline Drawer`
   - Opens from any phone number, live call, needs-action row, or history row.
   - Purpose: fast context without leaving the command center.
3. `Caller History Page`
   - Recommended route: `/portal/app/call-center/callers/[phone]`.
   - Purpose: deeper review, audits, longer notes, full timeline, and future reporting-adjacent details.
4. `Reporting / Analytics`
   - Separate later surface, not part of this first pass.
   - Purpose: trends, call-center performance, unresolved aging, callback rates, and team metrics.

Recommended desktop layout:

- Keep the existing two-column structure, but add a compact operational status bar above it.
- Top status bar:
  - Active calls.
  - Needs action count.
  - Available / busy stations.
  - History count.
  - Live indicator.
- Left column:
  - Live queue at the top, because active callers are always the highest priority.
  - A new `Needs action` panel under the queue for unresolved missed calls without voicemails, voicemails, callback-needed items, and follow-up-required items.
  - A new `History` panel under that for all paginated call history.
- Right column:
  - Station selector and presence controls remain at the top.
  - Softphone stays directly under station controls.
  - Post-call disposition appears inside the softphone card after a handled call ends, before the dialer returns to idle. If implementation is simpler, it can sit directly above the softphone, but it should feel attached to the completed call rather than like a separate admin form.
- Caller timeline opens in a right-side drawer on desktop and a full-screen sheet on mobile.
- If a call is active, timeline access should not cover the softphone controls.
- The drawer should include an `Open full history` action for the full caller page.

Spacing and hierarchy:

- Use compact rows, not large cards, for history and timeline entries.
- Avoid nested cards and giant expanded timeline blocks inside the command-center page.
- Reserve visual weight for unresolved work: callback-needed and follow-up-required rows should have stronger status badges than completed/resolved calls.
- Keep row metadata in one predictable line: time, direction/channel, location, station/handled-by, disposition.
- Phone numbers should be clickable everywhere they appear and open the caller timeline.
- The current `Dismiss` action should become `Mark resolved`; avoid a trash icon for patient communication work because it reads as deletion rather than completion.
- `Resolved` means staff intentionally cleared the item. It does not mean the caller left a voicemail.
- If a missed call produced a voicemail, show the voicemail as the canonical needs-action item instead of showing both a missed call row and a voicemail row.
- Hollywood / Sweetwater should appear as row metadata when known, not as top-level tabs.

Recommended panels:

1. `Live queue`
   - Shows only active, ringing, and transfer callers.
   - Shows caller, wait time, source/location when known, current state, and answering/transfer station when known.
   - Primary actions: Take, Take transfer, Call back, Open timeline.
2. `Needs action`
   - Shows unresolved caller threads only: one row per phone number, not one row per missed call.
   - Groups repeated missed calls, voicemails, callback-needed items, and follow-up-required items for the same caller.
   - Shows the caller count as the primary number, with raw event count as quieter context. Example: `83 callers need action`, `1,662 events grouped`.
   - Shows a compact row summary: caller, phone, `6 missed calls`, `1 voicemail`, last activity, and Hollywood / Sweetwater metadata when known.
   - Primary actions: Call back, Mark resolved, Open history.
   - Clicking the caller should open quick caller context first when the drawer exists; until then it opens the full number profile.
3. `History`
   - Shows all calls with filters and pagination.
   - Shows enough context to scan without opening the drawer: time, direction, phone/name, location, station, status, disposition.
   - Keep rows ledger-like. Do not show `Profile` or `Call back` buttons in History.
   - The phone number itself is the full-history link.
   - The command-center panel can stay capped for scanability, but it should link to a global history page.
   - The global history page should show expanded inbound/outbound call history, totals, `24h` / `7d` / `All` range filters, and compact previous/next pagination.
   - Default the global history page to `24h`; `7d` and `All` are explicit user choices.
   - Keep the global history page location-free; Hollywood / Sweetwater can remain row metadata elsewhere, but the expanded history should behave as the global command-center log.
4. `Post-call`
   - Shows immediately after a staff-handled call ends.
   - One-click disposition buttons first; optional note below.
5. `Caller timeline`
   - Shows the full caller record across calls, voicemails, dispositions, notes, and texts if available.
   - Opens as a drawer for quick context and links to the full caller history page.
6. `Number profile`
   - Full page for one phone number.
   - Shows status, summary metrics, Needs action items, then one deduplicated timeline.
   - Includes outbound calls and texts associated with the number.
   - Includes simple history range controls: `24h`, `7d`, and `All`.
   - Shows inbound, outbound, and total activity counts for the selected range.

## Needs Action Grouping Rules

The command center should reduce noise without hiding useful audit history.

- `Needs action` is a follow-up queue, not a missed-call log.
- Group by normalized caller phone number.
- Treat one caller thread as one action, even if it contains several missed calls or a voicemail.
- Show the most recent unresolved item as the active follow-up prompt.
- Show prior missed calls, voicemails, texts, and connected calls in the caller history, not as separate actions.
- Multiple missed calls from the same number in a short period should become one caller thread.
- A missed call with a voicemail should be represented by the voicemail-led thread, not a duplicate missed-call row.
- If the same number has a later connected inbound or outbound call, older missed-call and voicemail items can be cleared from the queue as likely resolved.
- Do not auto-clear explicit staff-created work such as `Callback needed` or `Follow-up required`; those require manual resolution.
- `Mark resolved` on a caller thread should resolve the whole open thread for that phone number.
- Keep raw calls, voicemails, texts, dispositions, notes, and resolution events visible in History / Number profile for auditability.
- Use one vocabulary term: `Needs action`. Do not introduce a separate `Needs attention` state.

## Current Confirmed Issues

### List Caps

The current portal data query caps:

- Missed calls at 30.
- Voicemails at 30.
- Combined activity at 60.
- Recent completed inbound calls at 25.

This explains reports that the missed-call list seems limited.

Relevant files:

- `lib/call-center.ts`
- `app/portal/app/call-center/ActivityRail.tsx`

### Transfer Completion Gap

Successful transferred calls can become completed at the queue/ring-attempt level without the original inbound `CallCenterSession` becoming `COMPLETED`. Since Recents only includes completed inbound sessions, these calls can avoid both Missed and Recents.

Relevant files:

- `lib/call-center.ts`
- `lib/__tests__/call-center.test.ts`

### Data Model Gaps

The current data model does not yet have durable call-center dispositions or staff-entered notes. Session and queue metadata mostly track the latest event payload, not a full audit trail.

Relevant files:

- `prisma/schema.prisma`
- `lib/call-center.ts`

## Phase 1: Fix Disappearing Transferred Calls

Goal: every successfully handled inbound call should appear in history.

Implementation:

- Update transfer/ring-attempt completion logic so that when an answered or bridged agent leg completes, the linked inbound `CallCenterSession` is also marked `COMPLETED`.
- Preserve the existing missed-call behavior: if a call was answered or bridged, it should not become missed.
- Add a defensive helper that can reconcile queue/session state:
  - Queue item is `COMPLETED`.
  - Caller session is still `RINGING` or `ACTIVE`.
  - Caller session should be moved to `COMPLETED` with the best known `endedAt`.
- Add tests for:
  - Basic handled inbound call appears in Recents/history.
  - Transferred call completed by target station appears in Recents/history.
  - Transferred call completed after source station hangs up still appears in Recents/history.
  - Unanswered call still creates a missed call.

Acceptance criteria:

- A successful transfer cannot disappear from both Missed and Recents/history.
- `answeredBy` reflects the station that answered or bridged when available.
- Existing missed-call tests continue to pass.

## Phase 2: Replace Capped Lists With Paginated History

Goal: users can see the full history instead of only the latest 25-30 records.

Implementation:

- Rename/reframe the current `Activity` area into a `Needs action` panel for unresolved work.
- Replace the separate `Recent calls` section with a paginated `History` panel so users do not have to mentally reconcile Activity vs Recents.
- Add the command-center status bar above the main two-column frame so live counts are visible before staff scans the panels.
- Replace fixed `take` values with cursor pagination for:
  - Missed calls.
  - Voicemails.
  - Completed inbound calls.
  - Outbound calls.
- Keep the default view focused on unresolved work:
  - Missed unresolved, only when no voicemail exists for that missed call.
  - Voicemail unresolved.
  - Callback needed.
  - Follow-up required.
- Add a general history view with filters:
  - All
  - Needs follow-up
  - Missed
  - Voicemail
  - Completed
  - Outbound
- Add a search box for phone number/caller name once the merged history query exists.
- Make search available before the timeline drawer is opened; staff should not need to find a row first if a patient calls back asking about prior contact.
- Make `View all` / `Load more` fetch more records from the server instead of only revealing already-fetched records.
- Show clear total counts: `Showing 25 of 143`, not just the number loaded on the page.

Acceptance criteria:

- Users can load older records beyond 30 missed calls and beyond 25 recents.
- Counts match the filtered total, not just the first page.
- No location split is added for Hollywood / Sweetwater.
- `Needs action` and `History` have distinct jobs, so staff can immediately tell what still needs work.
- The top status bar gives an at-a-glance read on active calls, open work, station availability, and history volume.

## Phase 3: Caller Timeline

Goal: clicking a caller number opens one complete history for that caller.

Timeline content:

- Inbound calls.
- Outbound calls.
- Missed calls.
- Voicemails.
- Transfer events.
- Dispositions.
- Staff notes.
- Text messages when available from existing SMS data.

Recommended UI:

- Add a caller timeline drawer from live queue, active softphone caller, needs-action rows, and history rows.
- Make number profile access explicit with a visible `Profile` action; the phone number can also remain clickable.
- In History specifically, keep access simple: the number link opens the full number profile.
- Keep the drawer optimized for fast review inside the command center.
- Add a full caller history page at `/portal/app/call-center/callers/[phone]` for deeper review.
- Include an `Open full history` action from the drawer.
- Header:
  - Phone number.
  - Caller name when known.
  - Latest status: unresolved, callback needed, follow-up required, resolved.
- Timeline rows:
  - Date/time.
  - Channel: inbound call, outbound call, voicemail, text, note, disposition.
  - Location when known.
  - Station/team member when known.
  - Outcome/disposition.
  - Note preview.
- Use a sticky header with quick actions so users can call back or mark resolved without scrolling.
- Group timeline rows by day for easier scanning.
- For transferred calls, show both the original answering station and the final transfer station when available.
- Provide quick actions:
  - Call back.
  - Mark resolved.
  - Add note.
  - Set disposition.

Data approach:

- Normalize phone numbers before matching.
- Build a timeline query that merges call-center sessions, missed calls, voicemails, dispositions, notes, and optional SMS messages into one sorted list.
- Deduplicate system artifacts:
  - Do not show a missed-call row and voicemail row for the same caller moment.
  - Do not show an inbound missed session row and a missed-call row for the same event.
  - Prefer the actionable row users can resolve.
- Reuse the same timeline query for the drawer and full caller page; the page can show more rows and more note/detail space.
- For outbound calls, capture checked-in station metadata at call creation so future outbound history rows can show the station.
- Prefer deriving the timeline from durable rows instead of parsing transient Telnyx webhook metadata.
- Add a durable call-center event/audit table if transfer events cannot be reliably reconstructed from sessions, queue items, and ring attempts.
- Reuse one phone normalization strategy for call-center and SMS lookup so a caller's texts and calls do not split into separate histories.
- Respect existing portal access/location scope for SMS rows; do not show texts from an inbox the current portal user cannot access.

Durable event examples:

- Call queued.
- Station answered.
- Transfer requested.
- Transfer accepted.
- Transfer failed/no answer.
- Call completed.
- Disposition saved.
- Follow-up resolved.

Acceptance criteria:

- A user can search/click a caller and see all known interactions with that phone number.
- A user can get quick context without leaving the command center.
- A user can open a dedicated caller page when the timeline needs deeper review.
- Staff can see who handled the call by station.
- Notes and dispositions appear in the same timeline as calls.
- Legacy calls without dispositions still appear in the timeline and history.

## Phase 4: Post-Call Disposition

Goal: staff can document what happened after each handled call with minimal friction.

Recommended workflow:

- After a staff-handled call ends, show a small post-call panel.
- Put the panel inside the softphone card on desktop and mobile.
- Make the panel visually compact: caller number, handled-by station, disposition buttons, optional note.
- Require one disposition button before the station fully returns to available, but keep the interaction one click for common outcomes.
- Keep notes optional.
- If staff closes/skips the panel, create an unresolved "No disposition" internal state only if needed for QA, but do not expose it as a user-facing disposition unless we decide it is useful.
- Do not require a note for `Callback needed` or `Follow-up required`; speed matters more than perfect notes.
- Allow staff to add or edit a note later from the caller timeline.
- When an outbound callback is launched from an unresolved item, ask `Did this resolve it?` after the call ends. This prevents callback-needed rows from staying unresolved after staff already followed up.

Disposition behavior:

| Disposition        | Default state       | Meaning                                 |
| ------------------ | ------------------- | --------------------------------------- |
| Resolved           | Resolved            | Caller issue was handled.               |
| Callback needed    | Unresolved          | Someone needs to call the patient back. |
| Follow-up required | Unresolved          | Some non-callback follow-up is needed.  |
| Wrong number       | Resolved            | No patient follow-up needed.            |
| Other              | Resolved by default | Staff can add context in notes.         |

Data model proposal:

- Add `CallCenterDisposition`.
- Fields:
  - `id`
  - `practiceId`
  - `locationId`
  - `sessionId`
  - `queueItemId`
  - `fromPhone`
  - `stationSeatId`
  - `stationLabelSnapshot`
  - `stationExtensionSnapshot`
  - `browserSessionId`
  - `userId`
  - `createdByUserId`
  - `status`
  - `note`
  - `unresolved`
  - `resolvedByUserId`
  - `resolvedBySeatId`
  - `resolvedAt`
  - `createdAt`
  - `updatedAt`
- Optional later table: `CallCenterNote`, if notes need to exist independently from disposition.

API/UI work:

- Add server action or API route to save disposition.
- Add "Mark resolved" action for unresolved disposition rows.
- Show unresolved callback/follow-up items in the default call-center activity view.
- Show disposition and note rows in caller timeline.
- Capture station attribution on save, even if user attribution is shared or ambiguous.
- When resolving an unresolved item, capture resolver user, resolver station, and resolved timestamp.

Acceptance criteria:

- Every completed staff-handled call can receive a disposition.
- Callback needed and Follow-up required remain visible until resolved.
- Notes are visible to all portal users with call-center access.
- Disposition data is queryable for later reporting.
- Callback-needed and follow-up-required rows show age, source call, creator station, latest callback attempt when known, and resolver when resolved.

## Implementation Order

1. Fix session completion for transferred calls and add tests.
2. Add explicit station check-in / remembered station selection for shared-login staff.
3. Add disposition schema, resolver attribution, and persistence.
4. Add durable transfer/timeline event storage if reconstruction is not reliable.
5. Add the command-center status bar and reorganize the main frame into Live queue, Needs action, History, and Station console.
6. Add the post-call panel inside the softphone card.
7. Convert Activity/Recents into `Needs action` and paginated `History`.
8. Add caller timeline drawer using the new history/disposition/event data.
9. Add the full caller history page using the same timeline data source.
10. Add SMS rows to the timeline if existing SMS data can be joined cleanly by normalized phone number.

## Open Implementation Checks

- Confirm how station identity maps to a real external call-center agent in practice. If multiple people reuse one station, attribution will only be station-level.
- Confirm whether the post-call panel should appear for outbound calls as well as inbound calls. Recommended first version: inbound staff-handled calls only.
- Confirm whether `Other` should ever remain unresolved. Recommended first version: resolved by default.
- Confirm whether skipped/missing dispositions should be visible to staff. Recommended first version: avoid exposing this unless it becomes a QA need.
- Confirm whether station check-in should be required for every browser session or only for shared-login Abita call-center users. Recommended first version: require it for shared-login users.
