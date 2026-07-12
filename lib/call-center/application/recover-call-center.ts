import { recoverProviderCommands } from "@/lib/call-center/application/recover-provider-commands";
import { recoverProviderWebhooks } from "@/lib/call-center/application/recover-provider-webhooks";

export async function recoverCallCenter() {
  const [webhooks, commands] = await Promise.all([
    recoverProviderWebhooks(),
    recoverProviderCommands(),
  ]);
  return { ...webhooks, commands };
}
