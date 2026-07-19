# Call Center Platform Specification

Status: Canonical production runtime

Last reviewed: 2026-07-19

## Decision

`acuity_site` has one call-center implementation for every practice, location,
queue, phone number, and user. An enabled, configured queue is live. There is no
`LEGACY`, `SHADOW`, or `ACTIVE` queue mode, no activation preflight, and no
runtime feature flag that selects a second implementation.

Customer differences are data:

- `CallCenterNumber` maps a practice phone number to an inbound queue and
  controls whether it may be used for outbound caller ID.
- `CallCenterQueue` owns membership, location scope, and voicemail configuration.
- `CallCenterQueueMember` authorizes users to receive a queue's calls.
- `CallCenterEndpoint` binds one provider calling identity to one portal user.
- `CallCenterAgentSession` represents one user's current browser connection and
  readiness.

The application remains a modular monolith: Next.js, Postgres, Telnyx, and one
versioned snapshot. Provider callbacks and commands are durable database work;
the browser is never the source of call truth.

## Runtime

```mermaid
flowchart LR
  Caller["Caller or Abita agent"] --> Telnyx["Telnyx voice application"]
  Telnyx --> Webhook["Verified webhook inbox"]
  Webhook --> Projector["Canonical call projector"]
  Projector --> Call["Call, legs, tasks, events"]
  Call --> Router["Queue routing and durable commands"]
  Router --> Telnyx
  Call --> Snapshot["Versioned snapshot"]
  Snapshot --> Portal["Portal call center"]
  Portal --> API["Authenticated idempotent actions"]
  API --> Call
```

Inbound calls ring every eligible ready browser in deterministic order. A user
remains `AVAILABLE` while a call is only offered. `Answer` accepts the exact
browser media leg and waits for the SDK to report connected media. For inbound
calls, the user becomes `BUSY` only after a provider-confirmed bridge. An
outbound call becomes connected when the remote party answers. Hangup releases
the user.

Starting an outbound call first ends this agent's waiting inbound offers through
durable provider commands. Only after those commands are accepted does the
server create the canonical outbound call and agent leg. The browser then dials
with opaque, server-issued correlation state.

Direct handoff uses:

```text
abita_agent -> authenticated Acuity handoff API -> one-time SIP route
            -> Telnyx callback -> configured queue -> ready browser endpoints
```

The public phone-number hop is not required for direct handoff. The handoff API
selects the configured Acuity number and queue; the SIP URI is provider ingress,
not a browser endpoint.

## Source of truth

- `CallCenterCall`: one logical inbound or outbound call and terminal outcome.
- `CallCenterCallLeg`: one customer or agent provider leg.
- `CallCenterCommand`: one durable provider effect with one idempotency key.
- `ProviderWebhookEvent`: one verified, deduplicated provider callback.
- `CallCenterEvent`: append-only audit revision.
- `CallCenterTask`: one missed-call, voicemail, note, callback, or follow-up item.
- `CallCenterVoicemail`: one recording attached to one call.
- `CallCenterAgentSession`: one browser lease, connection, and readiness state.

`effectOwner` remains only as an immutable compatibility fence for provider
sessions admitted before this cleanup. Every newly configured call is
canonical. It is not an activation switch and is not exposed to configuration
or the portal.

## Invariants

1. One user owns at most one enabled provider endpoint and one live browser
   session.
2. `AVAILABLE` requires a fresh lease, ready provider connection, microphone,
   and browser audio.
3. An inbound ring or answer does not make a user `BUSY`; a confirmed bridge
   does. An outbound remote answer is already a connected call.
4. One call has at most one winning agent leg; losing legs are canceled.
5. Customer answer is not staff answer.
6. A call cannot enter voicemail while a live agent leg remains.
7. Terminal call and leg states never regress.
8. Provider event IDs and command idempotency keys are unique and replay-safe.
9. All command authorization is practice, location, queue, user, session, and
   call scoped.
10. Each versioned snapshot is authoritative; browser media observations never
    independently change logical call state.
11. Logs contain IDs and categorical errors, not patient data, credentials, or
    raw provider payloads.
12. Provider commands dispatch immediately and a bounded outbox drain recovers
    interrupted sends; terminal failures remain visible for operator diagnosis.
13. Configuration writes, webhook projection, outbound creation, and
    provider-command transitions acquire one transaction-scoped practice lock
    before row locks. Provider I/O occurs only after the database transaction
    releases that lock.

## Schema cleanup

Migration `20260715110000_canonical_call_center_note_kind` adds the task shape in
its own PostgreSQL transaction. Migration
`20260715120000_canonical_call_center_cleanup` then preserves historical
sessions, missed calls, voicemail recordings, and notes as canonical calls,
events, tasks, and voicemail rows before removing the retired tables and enums.
Duplicate legacy session legs collapse into one call; duplicate recordings are
preserved on separate historical calls.

The portal reads only canonical tables. The removed legacy APIs, profile
branches, station selector, legacy workspace, shadow shell, migration report,
bootstrap, recovery report, and activation preflight have no runtime path.

## Configuration and secrets

`CRON_SECRET` authenticates the bounded provider-command outbox drain. Provider
credentials, the direct-handoff service credential/SIP destination, and database
connectivity remain operational secrets. Queue, number, membership, endpoint,
and caller-ID behavior belongs in Postgres.

## Verification contract

For each configured number, prove inbound ring, Answer/bridge, concurrent
answers with one bridge winner, browser refresh/reconnect, hangup/release,
no-ready voicemail, outbound dial, direct handoff where configured, outbox
recovery, and terminal history/task state. Duplicate and out-of-order provider
fixtures must converge without a second provider effect.
