import type { ProviderCommandDispatchResult } from "@/lib/call-center/application/dispatch-provider-command";
import { dispatchProviderCommand } from "@/lib/call-center/application/provider-command-runtime";
import {
  PROVIDER_COMMAND_MAX_ATTEMPTS,
  PROVIDER_COMMAND_SENDING_LEASE_MS,
} from "@/lib/call-center/domain/provider-command";
import { resolveCanonicalCommandDispatchConfig } from "@/lib/call-center/infrastructure/command-dispatch-config";
import { prismaProviderCommandStore } from "@/lib/call-center/infrastructure/prisma-provider-command-store";

const RECOVERY_BATCH_SIZE = 5;

export type ProviderCommandRecoveryResult = {
  dispatched: number;
  enabled: boolean;
  failed: number;
  selected: number;
  skipped: number;
  stale: number;
};

type Dependencies = {
  clock?: () => Date;
  config?: typeof resolveCanonicalCommandDispatchConfig;
  dispatch: (commandId: string) => Promise<ProviderCommandDispatchResult>;
  store: {
    listRecoverable(input: {
      limit: number;
      maxAttempts: number;
      now: Date;
      staleBefore: Date;
    }): Promise<Array<{ id: string }>>;
  };
};

export function createProviderCommandRecovery({
  clock = () => new Date(),
  config = resolveCanonicalCommandDispatchConfig,
  dispatch,
  store,
}: Dependencies) {
  return async function recoverProviderCommands(): Promise<ProviderCommandRecoveryResult> {
    if (!config().enabled) {
      return {
        dispatched: 0,
        enabled: false,
        failed: 0,
        selected: 0,
        skipped: 0,
        stale: 0,
      };
    }

    const now = clock();
    const commands = await store.listRecoverable({
      limit: RECOVERY_BATCH_SIZE,
      maxAttempts: PROVIDER_COMMAND_MAX_ATTEMPTS,
      now,
      staleBefore: new Date(now.getTime() - PROVIDER_COMMAND_SENDING_LEASE_MS),
    });
    let dispatched = 0;
    let failed = 0;
    let skipped = 0;
    let stale = 0;

    for (const command of commands) {
      try {
        const result = await dispatch(command.id);
        if (result.status === "DISPATCHED") dispatched += 1;
        else if (result.status === "FAILED") failed += 1;
        else if (result.status === "STALE") stale += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
    }
    return {
      dispatched,
      enabled: true,
      failed,
      selected: commands.length,
      skipped,
      stale,
    };
  };
}

export const recoverProviderCommands = createProviderCommandRecovery({
  dispatch: dispatchProviderCommand,
  store: prismaProviderCommandStore,
});
