# Call Center Deployment Runbook

Last reviewed: 2026-07-21

This is a normal canonical deployment, not an activation rollout. There is no
preflight approval, shadow stage, queue mode, or global enable switch.

## Before merge

1. Confirm every enabled inbound number has one enabled queue.
2. Confirm every enabled queue has a location, enabled agent membership, and at
   least one enabled user-owned endpoint with provider credentials and SIP
   identity.
3. Confirm every outbound-enabled number is an allowed caller ID and the
   practice default points to an enabled outbound number.
4. Run Prisma validation, formatting, lint on changed files, TypeScript, the
   complete test suite, and the production build.
5. Prove new migrations on an empty database and replay the complete migration
   history. Never use `prisma db push` in production.
6. Confirm production application traffic uses the database provider's pooled
   runtime URL in `DATABASE_URL`. Keep the direct URL in `DIRECT_URL` or
   `PRISMA_DATABASE_URL` for Prisma migrations and administrative tools.
   Vercel defaults to two application connections per function instance;
   `DATABASE_POOL_MAX` may override that only within the database connection
   budget.

## Deploy

1. Merge the application and every committed migration to `main`.
2. Run the production migration workflow with its normal `confirm=DEPLOY`
   authorization.
3. Deploy `main`. Do not add or toggle a call-center activation environment
   variable.
4. Leave provider credentials and direct-handoff route values unchanged unless
   the deployment explicitly changes that integration.

The SQL migrations are forward-only. Roll back the application only to a
revision that understands the deployed schema. In particular, do not restore
the retired provider-event owner fence, dual inbox, browser-owned outbound call
creation, retired tables, or run destructive reverse SQL.

This retirement accepts one provider-contract risk: Telnyx does not publish its
default Voice webhook retry ceiling. The release owner assumes a finalized
Voice webhook will not be automatically or manually redelivered more than 72
hours after its final delivery record. If a later callback disproves that
assumption, preserve the event and canonical call evidence; do not recreate the
dual lifecycle.

## Production verification

Use one controlled user in each configured queue and call every configured
inbound number.

1. Ready user: the portal rings, the user remains `AVAILABLE`, `Answer` bridges
   once, the winner becomes `BUSY`, losing offers disappear, and hangup returns
   the user to `AVAILABLE`.
2. Concurrency: answer from two eligible browsers; only one provider-confirmed
   bridge wins and the losing leg ends.
3. Reconnect: refresh or navigate away and back while ringing and while
   connected; the same server session/call state restores.
4. No ready user: voicemail starts immediately. With live offers, the fixed
   20-second window expires once before voicemail starts and creates one task.
5. Outbound: dial through each allowed caller ID, bridge, hang up, and confirm
   terminal history.
6. Cold transfer: from a connected call, select one available staff member at
   the same location; confirm their browser rings and requires Answer, the source
   remains connected until answer and bridge evidence, and no-answer leaves the
   source call active.
7. Direct handoff: for configured agents, issue one handoff, confirm direct SIP
   ingress without a public-number hop, then complete the normal ring/Answer flow.
8. Recovery: leave a committed provider command pending and confirm the
   authenticated outbox drain sends it once.

## Health queries

Healthy production has:

- no failed provider events or commands awaiting operator investigation;
- no provider event with an expired `PROCESSING` claim;
- no ambiguous command/event correlation;
- no active call past its queue or ring deadline;
- no `BUSY` agent without a current connected call;
- no `AVAILABLE` session lacking ready media signals;
- no enabled number without an enabled queue; and
- no enabled endpoint without exactly one user and compatible membership.

## Incident response

- Stop new provider ingress only for a provider/security incident.
- For a call-flow defect, preserve webhook, command, call, leg, and event rows;
  diagnose by provider session and call ID.
- Diagnose failed durable work from its stored event or command before changing
  application or provider configuration.
- Never replay raw provider commands manually or infer ownership from caller
  phone, email, display name, or the first matching row.
