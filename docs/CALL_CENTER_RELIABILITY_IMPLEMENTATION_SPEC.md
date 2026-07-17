# Call Center Reliability Implementation Spec

**Status:** Proposed

**Prepared:** July 17, 2026

**Scope:** Inbound calls, outbound calls, Take, Hold, Resume, End, browser station lifecycle, call history, realtime updates, and multi-tab behavior

## Objective

Make the Acuity call center predictable by enforcing one canonical call workflow and one persistent browser softphone per agent. The implementation must eliminate split ownership between the browser, canonical server, realtime projections, legacy reads, and Telnyx.

This is a reliability correction, not a full call-center rewrite. The work should be delivered in small, independently reviewable changes that preserve useful canonical foundations and remove competing live paths only after their replacements are complete.

## Confirmed failure themes

1. Commands can be created before the required Telnyx call leg or provider state is confirmed.
2. Browser-originated calls can connect at Telnyx without their provider identifiers being attached to the canonical Acuity call.
3. The TelnyxRTC client is owned by the Call Center route, so navigation or a route-level error can disconnect the phone.
4. Browser actions and server commands do not share one durable intent, acknowledgement, and reconciliation protocol.
5. Multiple tabs can compete for the same station without one safely fenced controller.
6. Realtime and legacy read paths can be slow or stale, while the UI treats them as if they are authoritative.
7. Failure evidence is fragmented across browser state, Vercel logs, database rows, and Telnyx records.

The detailed incident evidence is maintained separately from this implementation contract.

## Target ownership model

| Concern | Authority |
|---|---|
| Queue membership, availability, agent selection, call sessions, and command state | Acuity canonical server |
| Provider call and leg truth | Telnyx events ingested by the canonical server |
| PSTN orchestration, agent dialing, bridging, transfer, and recording | Acuity backend through Telnyx Call Control |
| Local microphone, speaker, WebRTC media, and SDK-required actions | Persistent browser StationRuntime |
| Which browser may control the phone | One active tab/device with a server-issued fencing epoch |
| Call Center pages, history, and realtime UI | Derived subscribers; never call authorities |

The browser may execute an action through the Telnyx SDK when that is the provider-supported transport, but the action must still be durably recorded and reconciled with canonical server and provider state.

## Required invariants

1. Every Acuity call session must correlate to all known Telnyx call-control IDs, leg IDs, browser call IDs, commands, and provider events.
2. A dependent command cannot execute until its required provider identifiers and state are confirmed.
3. Telnyx webhook delivery may be duplicated, concurrent, or out of order without corrupting canonical state.
4. Every provider-affecting command and browser action must have a stable idempotency key and terminal result.
5. The UI cannot display `Connected`, `Held`, `Ended`, or another terminal call state solely because a user clicked a button or a request was accepted.
6. Navigating within Acuity must not create, disconnect, or replace the active TelnyxRTC client.
7. Multiple tabs may be open for one agent, but only one tab/device may operate the softphone at a time.
8. A stale browser leader cannot answer, hold, resume, end, or originate calls after its fencing epoch has been replaced.
9. Realtime delivery is a display optimization. Reconnecting clients must recover from a bounded canonical snapshot.
10. Call finalization and history creation must be idempotent and derive from canonical terminal evidence.

## Implementation work

### 1. Canonical contract and correlated timeline

Establish one searchable timeline for each call containing:

- Acuity call and session ID
- practice, location, queue, and agent ID
- station session, client instance, device, active tab, and fencing epoch
- Telnyx call-control, session, leg, and browser call IDs
- browser intents and acknowledgements
- server commands, prerequisites, attempts, and results
- Telnyx webhook event IDs and provider states
- canonical state transitions and final outcome

Every log entry and durable event must carry the applicable correlation identifiers. Sensitive patient data and credentials must not be logged.

### 2. Command ordering and provider correlation

- Attach Telnyx identifiers as soon as the corresponding webhook or browser acknowledgement is durably accepted.
- Express every command's prerequisites explicitly.
- Keep a command pending when a prerequisite has not arrived; do not fail it as though Telnyx rejected it.
- Execute commands through one outbox with idempotency, bounded retries, and terminal results.
- Reconcile ambiguous responses against Telnyx state before retrying or declaring failure.
- Process webhook receipt durably and idempotently before applying canonical transitions.
- Prevent more than one agent from successfully claiming the same queue offer.
- Compensate a committed claim when the selected browser cannot answer or acknowledge the agent leg.
- Finalize call history only once, from canonical terminal evidence.

### 3. Persistent browser StationRuntime

Move the TelnyxRTC client, station lease, active call objects, connection supervision, and audio controls into the authenticated portal shell rather than the Call Center route.

The runtime must:

- survive navigation between Call Center, Texting, and other portal routes;
- maintain exactly one operating TelnyxRTC client for the active station;
- distinguish `Connecting`, `Ready`, `Reconnecting`, `Unavailable`, and signed-out states;
- wait for `telnyx.ready` before allowing provider-dependent actions;
- use supported SDK reconnection and recovered-call behavior;
- retain the call UI during transient signaling recovery;
- preserve active calls when route views mount or unmount;
- release the station only on explicit sign-out, explicit device takeover, or confirmed terminal cleanup;
- expose bounded state to route views without giving those views lifecycle ownership.

### 4. One active controller with passive tabs

The same agent may use multiple Acuity tabs, but only one active browser context may register and control the phone.

- Assign every tab a unique client instance ID.
- Elect one active controller and bind it to a server-issued fencing epoch.
- Keep follower tabs connected to canonical UI state without registering another TelnyxRTC client.
- Reject provider-affecting actions from stale epochs.
- Support an explicit device or tab takeover.
- Do not attempt an unsafe ownership transfer during an active call unless the Telnyx recovery contract supports it.

### 5. Unified action and acknowledgement protocol

Take, Outbound Dial, Hold, Resume, and End must follow one logical lifecycle:

1. The user submits an intent with an action ID, call session ID, station session ID, fencing epoch, and expected state version.
2. The canonical server validates authorization, leadership, call existence, and provider prerequisites.
3. The action is durably marked pending.
4. The supported executor performs the effect through Telnyx Call Control or the browser SDK.
5. Browser acknowledgement and/or Telnyx provider events are attached to the same action.
6. Canonical state advances only from confirmed evidence.
7. The UI receives a confirmed result, an actionable failure, or a bounded timeout followed by reconciliation.

Controls must not remain disabled indefinitely. End must remain available whenever a live call or live provider leg can be safely terminated, even if an intermediate projection such as `BRIDGED` is missing.

The final SDK-versus-Call-Control owner for Answer, Hold, Resume, End, mute, and DTMF must follow the workflow confirmed by the Telnyx implementation engineer.

### 6. Realtime, history, and error isolation

- Serve bounded, indexed canonical snapshots and paginated history.
- Resume realtime streams from a durable cursor.
- Reconcile from a canonical snapshot after a gap, reconnect, or cursor failure.
- Keep the last known safe call and station state visible during a transient read failure.
- Prevent a history, task-count, or legacy-read failure from making the phone unavailable.
- Replace full-page generic failures with localized, recoverable connection and data states.
- Remove legacy live reads and duplicate command paths only after canonical replacements satisfy this specification.

## Recommended PR sequence

### PR 1: Contract and observability

- Define the invariants and correlation fields.
- Add the unified call timeline and structured error evidence.
- Avoid changing call behavior unless required to capture evidence safely.

### PR 2: Server ordering and correlation

- Implement command prerequisites, provider-ID attachment, durable browser acknowledgement, queue-claim compensation, webhook idempotency, and canonical finalization.

### PR 3: Persistent StationRuntime

- Move TelnyxRTC and station ownership into the portal shell.
- Add connection supervision, route independence, and recovered-call handling.

### PR 4: Controller fencing and unified controls

- Add one active tab/device owner, passive followers, and the shared Take/Dial/Hold/Resume/End lifecycle.

### PR 5: Read-path resilience and simplification

- Bound snapshots and history, add realtime reconciliation, isolate page failures, and retire proven-unused legacy live paths.

Backend command/correlation work and frontend StationRuntime work may proceed in parallel after the ownership contract and identifiers are agreed. One engineer must own the shared contract so both lanes use identical states, action IDs, and acknowledgement semantics.

## PR #158 decision criteria

PR #158 should be used only where it advances this specification without removing recovery mechanisms prematurely.

Before incorporating a portion of PR #158, verify that it:

- establishes one real effect owner rather than only renaming a runtime canonical;
- preserves command, webhook, outbound, voicemail, and handoff recovery until replacements exist;
- contains current fixes from recent merged PRs;
- does not delete legacy data or contracts required for reconciliation;
- can be reviewed and verified as an independent change;
- directly satisfies one or more required invariants in this specification.

Split broad simplification, additive data migration, and destructive cleanup into separate changes.

## Reported-bug coverage

| Reported problem | Required implementation coverage |
|---|---|
| Take appears briefly, remains gray, or disappears | Canonical offer state, readiness gating, atomic claim, and claim compensation |
| “We couldn't answer this call” | Confirmed provider prerequisites, durable Take action, and agent-leg correlation |
| Inbound call rings less than once | Offer lifecycle must not terminate from a locally rejected premature command |
| Outbound requires repeated clicks | Persistent station readiness and durable outbound browser/provider acknowledgement |
| Outbound call connects but Acuity times out | Provider-ID attachment and ambiguous-result reconciliation |
| Cannot Hold, Resume, or End | Unified action lifecycle and controls based on live call existence rather than fragile projections |
| Connected / Not connected flicker | Persistent StationRuntime and explicit reconnecting state |
| Calls appear only after refreshing | Realtime cursor recovery and canonical snapshot reconciliation |
| Calls missing from history | Idempotent provider correlation and terminal finalization |
| Texting or navigation drops a call | Route-independent StationRuntime |
| Multiple tabs or computers make failures worse | One fenced active controller with passive followers and explicit takeover |
| “Temporarily unavailable” | Bounded snapshot reads, last-known state, and localized failures |
| “Something went wrong” | Structured exception correlation and an error boundary that does not destroy the phone runtime |
| Page refresh takes several minutes | Indexed, paginated read models without unbounded legacy hydration |

## Focused validation scenarios

The implementation is not complete until these behaviors are verified:

1. One agent takes an inbound queued call successfully.
2. Two agents attempt to take the same call; exactly one wins and the other receives a clean outcome.
3. An outbound call connects and all Telnyx identifiers and terminal events attach to the canonical call.
4. Hold and Resume each reach a confirmed state and remain usable after projection delay.
5. End terminates the correct live legs and finalizes history exactly once.
6. The agent navigates to Texting and other portal routes during an active call without media interruption.
7. A temporary network or signaling interruption displays Reconnecting and recovers without duplicate actions.
8. A second tab remains passive and cannot create a second phone registration or issue stale commands.
9. An explicit tab/device takeover fences the previous controller.
10. A refresh while idle restores readiness; a refresh during a call follows the Telnyx-supported recovery behavior.
11. Duplicate and out-of-order Telnyx webhooks converge to the same canonical result.
12. A slow or failed history/realtime request does not disconnect the phone or replace the call page with a fatal error.

Tests should concentrate on the canonical reducer/state machine, command prerequisites, webhook replay, browser acknowledgement, station leadership, and the scenarios above. A large unrelated test expansion is not required.

## Definition of done

- Every sampled Telnyx call can be reconstructed from one correlated Acuity timeline.
- No dependent command executes before its provider prerequisites are confirmed.
- Successful browser calls cannot remain canonical timeouts without provider IDs.
- Navigation and non-phone page failures cannot disconnect the active softphone.
- Duplicate tabs cannot independently operate the same agent's phone.
- Take, Dial, Hold, Resume, and End always reach a confirmed result, actionable failure, or reconciled timeout.
- Realtime gaps recover without requiring the operator to refresh repeatedly.
- Completed, missed, voicemail, and failed outcomes finalize once and appear in history.
- All reported problems in the coverage table have an implemented fix and a passing focused validation scenario.

## Telnyx decisions required

1. Confirm the proposed canonical-server, individual-agent-credential, persistent-browser-softphone ownership model.
2. Specify the exact Telnyx state/event prerequisites for inbound dialing, answering, linking/bridging, outbound correlation, and displaying a call as connected.
3. Specify SDK-versus-Call-Control ownership for Answer, Hold, Resume, End, and recovery across signaling reconnects or browser replacement.
