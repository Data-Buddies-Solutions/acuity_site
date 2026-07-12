import type { ProviderCommandDispatchResult } from "@/lib/call-center/application/dispatch-provider-command";
import { dispatchProviderCommand } from "@/lib/call-center/application/provider-command-runtime";
import { prismaCanonicalVoicemailRecovery } from "@/lib/call-center/infrastructure/prisma-canonical-voicemail-recovery";

export const CANONICAL_VOICEMAIL_RECOVERY_BATCH_SIZE = 25;

type Dependencies = {
  dispatch: (commandId: string) => Promise<ProviderCommandDispatchResult>;
  store: {
    recoverDue(
      now: Date,
      limit: number,
    ): Promise<{
      callIds: string[];
      commandIds: string[];
      finalized: number;
      recordingStarted: number;
      selected: number;
    }>;
  };
};

export function createCanonicalVoicemailRecovery({ dispatch, store }: Dependencies) {
  return async function recoverCanonicalVoicemails(
    now = new Date(),
    limit = CANONICAL_VOICEMAIL_RECOVERY_BATCH_SIZE,
  ) {
    const result = await store.recoverDue(now, limit);
    let dispatched = 0;
    let failed = 0;
    for (const commandId of result.commandIds) {
      try {
        const outcome = await dispatch(commandId);
        if (outcome.status === "DISPATCHED") dispatched += 1;
        else if (outcome.status === "FAILED") failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { ...result, dispatched, failed };
  };
}

export const recoverCanonicalVoicemails = createCanonicalVoicemailRecovery({
  dispatch: dispatchProviderCommand,
  store: prismaCanonicalVoicemailRecovery,
});
