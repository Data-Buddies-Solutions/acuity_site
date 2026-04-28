-- Add indexes for high-volume Telnyx webhook practice resolution.
CREATE INDEX "practice_call_center_settings_enabled_inboundPhoneNumber_idx"
ON "practice_call_center_settings"("enabled", "inboundPhoneNumber");

CREATE INDEX "practice_call_center_settings_enabled_outboundCallerNumber_idx"
ON "practice_call_center_settings"("enabled", "outboundCallerNumber");

CREATE INDEX "practice_call_center_settings_enabled_telnyxConnectionId_idx"
ON "practice_call_center_settings"("enabled", "telnyxConnectionId");
