# Canonical Call-Center Agent Sessions

Agent sessions are the browser-to-endpoint lease boundary for the production
call center.

## Contract

- `POST /api/portal/call-center/agent-sessions` acquires a 60-second endpoint
  lease and returns its canonical session. An exact live replay returns the
  existing session without mutating it or appending another event. Provider
  credentials are deliberately outside this transaction.
- `PATCH /api/portal/call-center/agent-sessions/:sessionId` heartbeats the lease
  with explicit provider connection, microphone, browser-audio, and presence
  state plus the last acknowledged `expectedStateVersion`.
- `DELETE /api/portal/call-center/agent-sessions/:sessionId` marks the session
  offline using the last acknowledged version and releases the endpoint.

Every request revalidates the authenticated practice, location scope, enabled
endpoint, and enabled queue membership. A location-bound endpoint requires a
membership in a global queue or a queue configured for that location. A global
endpoint requires a global queue. Client-supplied practice or queue IDs are not
accepted.

## Lease invariants

Endpoint acquisition locks the durable endpoint row. Inside that transaction it:

1. closes expired live sessions;
2. rejects a fresh lease owned by another user or browser;
3. returns the same user's same-client live session idempotently, or
   creates/reopens one canonical session; and
4. appends sanitized `CallCenterEvent` evidence with the session mutation.

The existing partial unique index on active endpoint sessions is the database
backstop. The endpoint row lock orders concurrent requests before they reach it.
The endpoint ID remains stable across reconnects and configuration edits.

`AVAILABLE` is accepted only when the provider connection is `READY`, microphone
and browser audio are ready, and no current call is attached. The UI should
heartbeat well inside the 60-second lease and reacquire after a `409` expiry.
Every heartbeat/readiness change, release, and expiry increments `stateVersion`.
A PATCH or DELETE with an older expected version returns `409`, so a delayed
provider-ready notification cannot overwrite a newer failure or pause.

The public request field is `clientInstanceId`. `browserSessionId` is a legacy
database column name and never appears on the canonical wire. The browser helper
stores the ID only in `sessionStorage`. Its `BroadcastChannel` probe detects the
identity copied when a new tab is opened and regenerates the second tab's ID
before check-in, causing an attempted shared endpoint to receive the server's
normal `409` lease conflict.

The passive lease route does not mint Telnyx credentials. The coordinated media
cutover must use a separate session-bound credential endpoint so a provider
failure cannot hide a committed lease from the browser that must release it.
Database `ERROR` and `CLOSED` states serialize to realtime `FAILED` and
`DISCONNECTED`; database enum names do not leak into the canonical contract.

## Runtime ownership

These routes are the only production presence boundary. The call-center UI uses
the session-bound credential endpoint for provider media, and routing uses the
same session readiness when selecting an endpoint. No second presence or media
owner runs beside it.
