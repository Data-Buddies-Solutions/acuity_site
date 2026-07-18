import { createProviderCommandDispatcher } from "@/lib/call-center/application/dispatch-provider-command";
import { prismaProviderCommandStore } from "@/lib/call-center/infrastructure/prisma-provider-command-store";
import {
  telnyxProviderCommandSender,
  telnyxProviderSendErrorClassifier,
} from "@/lib/call-center/infrastructure/telnyx-provider-command-sender";

export const dispatchProviderCommand = createProviderCommandDispatcher({
  classifyError: telnyxProviderSendErrorClassifier,
  enabled: true,
  maxAttempts: 1,
  sender: telnyxProviderCommandSender,
  store: prismaProviderCommandStore,
});
