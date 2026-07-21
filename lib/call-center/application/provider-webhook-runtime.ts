import { createProviderWebhookDrainer } from "@/lib/call-center/application/drain-provider-webhooks";
import { processTelnyxVoiceEvent } from "@/lib/call-center/application/process-telnyx-voice-event";
import { providerWebhookInbox } from "@/lib/call-center/infrastructure/provider-webhook-inbox";

export const drainProviderWebhooks = createProviderWebhookDrainer({
  backlog: providerWebhookInbox,
  processRecord: processTelnyxVoiceEvent.processRecord,
});
