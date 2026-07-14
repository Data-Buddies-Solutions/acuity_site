# Call center provider webhook replay

Replay failed Telnyx callbacks from `provider_webhook_event`; do not resend them from
Telnyx. The durable inbox payload and provider event ID are the source of truth.

## Outbound callback recovery

After deploying the callback-correlation fix:

1. Find the exact failed callback rows for the affected provider sessions. Confirm
   that only the expected `call.answered`, `call.bridged`, and `call.hangup` rows are
   selected and that their payloads have not been redacted.

   ```sql
   SELECT
     "id",
     "providerEventId",
     "providerCallSessionId",
     "eventType",
     "attemptCount",
     "processingStatus",
     "errorCode",
     "occurredAt",
     "payload" = '{"redacted":true}'::jsonb AS "payloadRedacted"
   FROM "provider_webhook_event"
   WHERE "provider" = 'TELNYX'
     AND "providerCallSessionId" IN ('<session-1>', '<session-2>')
     AND "eventType" IN ('call.answered', 'call.bridged', 'call.hangup')
   ORDER BY "occurredAt", "receivedAt";
   ```

2. If the rows exhausted their eight attempts, re-arm only the reviewed row IDs.
   The claim step clears the previous error when recovery begins.

   ```sql
   UPDATE "provider_webhook_event"
   SET
     "attemptCount" = 0,
     "nextAttemptAt" = NOW(),
     "processedAt" = NULL,
     "processingStatus" = 'FAILED'
   WHERE "id" IN (
     '<reviewed-event-id-1>',
     '<reviewed-event-id-2>',
     '<reviewed-event-id-3>',
     '<reviewed-event-id-4>',
     '<reviewed-event-id-5>',
     '<reviewed-event-id-6>'
   )
     AND "processingStatus" = 'FAILED'
     AND "errorCode" = 'TELNYX_EVENT_OUTBOUND_TOKEN_INVALID';
   ```

3. Let `/api/cron/call-center/recover` run twice, or invoke it twice with its existing
   cron authorization. Recovery processes five provider callbacks per run, oldest
   first, and then runs canonical projection.

4. Verify every reviewed callback is owned and projected canonically.

   ```sql
   SELECT
     "providerEventId",
     "eventType",
     "effectOwner",
     "processingStatus",
     "errorCode",
     "canonicalProjectionStatus",
     "canonicalProjectionErrorCode"
   FROM "provider_webhook_event"
   WHERE "id" IN (
     '<reviewed-event-id-1>',
     '<reviewed-event-id-2>',
     '<reviewed-event-id-3>',
     '<reviewed-event-id-4>',
     '<reviewed-event-id-5>',
     '<reviewed-event-id-6>'
   )
   ORDER BY "occurredAt", "receivedAt";
   ```

   Expected: `effectOwner = 'CANONICAL'`, main processing is `IGNORED` with no
   error, and canonical projection is `PROCESSED` with no error.

5. Verify both outbound calls have left `RINGING` and have an `endedAt` value.
   Calls with answered and hangup evidence should be `COMPLETED`.

   ```sql
   SELECT "id", "status", "endedAt"
   FROM "call_center_call"
   WHERE "id" IN ('<call-1>', '<call-2>');
   ```
