DO $$
DECLARE
  session_record RECORD;
  decoded_client_state JSONB;
BEGIN
  FOR session_record IN
    SELECT
      "id",
      "metadata" #>> '{payload,client_state}' AS client_state
    FROM "call_center_session"
    WHERE
      "direction" = 'OUTBOUND'
      AND "metadata" #>> '{payload,client_state}' IS NOT NULL
  LOOP
    BEGIN
      decoded_client_state :=
        convert_from(decode(session_record.client_state, 'base64'), 'UTF8')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      decoded_client_state := NULL;
    END;

    IF
      decoded_client_state ? 'queueItemId'
      OR decoded_client_state ? 'ringAttemptId'
      OR decoded_client_state ? 'seatId'
    THEN
      UPDATE "call_center_session"
      SET "direction" = 'INTERNAL'
      WHERE "id" = session_record.id;
    END IF;
  END LOOP;
END $$;
