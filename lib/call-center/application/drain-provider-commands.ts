import {
  dispatchProviderCommandGraph,
  type ProviderCommandDispatchResult,
} from "@/lib/call-center/application/dispatch-provider-command";
import { PROVIDER_COMMAND_SENDING_LEASE_MS } from "@/lib/call-center/domain/provider-command";
import { createLogger } from "@/lib/logger";

const logger = createLogger("call-center-provider-command-drain");

export interface ProviderCommandBacklog {
  listDispatchable(input: { limit: number; staleBefore: Date }): Promise<string[]>;
}

type Dependencies = {
  backlog: ProviderCommandBacklog;
  clock?: () => Date;
  dispatch(commandId: string): Promise<ProviderCommandDispatchResult>;
  limit?: number;
  sendingLeaseMs?: number;
};

/**
 * Wakes the durable command outbox. The dispatcher remains the sole transition
 * owner; this loop only supplies bounded command IDs after an inline wake was lost.
 */
export function createProviderCommandDrainer({
  backlog,
  clock = () => new Date(),
  dispatch,
  limit = 100,
  sendingLeaseMs = PROVIDER_COMMAND_SENDING_LEASE_MS,
}: Dependencies) {
  return async function drainProviderCommands() {
    const now = clock();
    const commandIds = await backlog.listDispatchable({
      limit,
      staleBefore: new Date(now.getTime() - sendingLeaseMs),
    });
    const result = await dispatchProviderCommandGraph({
      commandIds,
      dispatch,
      limit,
    });
    for (const failure of result.failures) {
      logger.error("provider command recovery failed", failure);
    }
    for (const commandId of result.deferred) {
      logger.warn("provider command recovery deferred", { commandId });
    }
    return {
      attempted: result.attempted,
      deferred: result.deferred.length,
      dispatched: result.dispatched,
      failed: result.failures.length,
    };
  };
}
