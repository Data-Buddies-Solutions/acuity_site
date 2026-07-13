import { recoverActiveInboundLifecycle } from "@/lib/call-center/application/recover-active-inbound-lifecycle";
import { recoverCanonicalVoicemails } from "@/lib/call-center/application/recover-canonical-voicemails";
import { recoverOutboundInitiations } from "@/lib/call-center/application/recover-outbound-initiations";
import { recoverProviderCommands } from "@/lib/call-center/application/recover-provider-commands";
import { recoverProviderWebhooks } from "@/lib/call-center/application/recover-provider-webhooks";
import { expireIssuedDirectHandoffs } from "@/lib/call-center/infrastructure/prisma-direct-handoff-recovery";

export async function recoverCallCenter() {
  const webhooks = await recoverProviderWebhooks();
  const [activeLifecycle, expiredHandoffs, outboundInitiations] = await Promise.all([
    recoverActiveInboundLifecycle(),
    expireIssuedDirectHandoffs(new Date()),
    recoverOutboundInitiations(),
  ]);
  const voicemail = await recoverCanonicalVoicemails();
  const commands = await recoverProviderCommands();
  return {
    ...webhooks,
    activeLifecycle,
    commands,
    expiredHandoffs,
    outboundInitiations,
    voicemail,
  };
}
