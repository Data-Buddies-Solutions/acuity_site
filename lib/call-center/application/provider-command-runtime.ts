import { createProviderCommandDispatcher } from "@/lib/call-center/application/dispatch-provider-command";
import { createProviderCommandDrainer } from "@/lib/call-center/application/drain-provider-commands";
import { prismaProviderCommandStore } from "@/lib/call-center/infrastructure/prisma-provider-command-store";
import {
  telnyxProviderCommandSender,
  telnyxProviderSendErrorClassifier,
} from "@/lib/call-center/infrastructure/telnyx-provider-command-sender";

export const dispatchProviderCommand = createProviderCommandDispatcher({
  classifyError: telnyxProviderSendErrorClassifier,
  enabled: true,
  sender: telnyxProviderCommandSender,
  store: prismaProviderCommandStore,
});

export const drainProviderCommands = createProviderCommandDrainer({
  backlog: prismaProviderCommandStore,
  dispatch: dispatchProviderCommand,
});
