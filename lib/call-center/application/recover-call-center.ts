import { recoverActiveInboundLifecycle } from "@/lib/call-center/application/recover-active-inbound-lifecycle";
import { recoverCanonicalVoicemails } from "@/lib/call-center/application/recover-canonical-voicemails";
import { recoverOutboundInitiations } from "@/lib/call-center/application/recover-outbound-initiations";
import { recoverProviderCommands } from "@/lib/call-center/application/recover-provider-commands";
import { recoverProviderWebhooks } from "@/lib/call-center/application/recover-provider-webhooks";

export async function recoverCallCenter() {
  const webhooks = await recoverProviderWebhooks();
  const [activeLifecycle, outboundInitiations] = await Promise.all([
    recoverActiveInboundLifecycle(),
    recoverOutboundInitiations(),
  ]);
  const voicemail = await recoverCanonicalVoicemails();
  const commands = await recoverProviderCommands();
  return { ...webhooks, activeLifecycle, commands, outboundInitiations, voicemail };
}
