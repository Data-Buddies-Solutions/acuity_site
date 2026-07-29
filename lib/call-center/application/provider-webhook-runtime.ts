import { drainActiveCalls } from "@/lib/call-center/application/active-call-runtime";
import { createProviderWebhookDrainer } from "@/lib/call-center/application/drain-provider-webhooks";
import { processTelnyxVoiceEvent } from "@/lib/call-center/application/process-telnyx-voice-event";
import { providerWebhookInbox } from "@/lib/call-center/infrastructure/provider-webhook-inbox";

const drainProviderWebhookInbox = createProviderWebhookDrainer({
  backlog: providerWebhookInbox,
  processRecord: processTelnyxVoiceEvent.processRecord,
});

export function drainProviderWebhookSession(providerCallSessionId: string) {
  return createProviderWebhookDrainer({
    backlog: {
      listDue: (limit) =>
        providerWebhookInbox.listSessionDue(providerCallSessionId, limit),
    },
    concurrency: 1,
    processRecord: processTelnyxVoiceEvent.processRecord,
  })();
}

export async function drainProviderWebhooks() {
  const webhooks = await drainProviderWebhookInbox();
  const activeCalls = await drainActiveCalls();
  return { ...webhooks, activeCalls };
}
