import type { ProviderWebhookRecord } from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import { createLogger } from "@/lib/logger";

const logger = createLogger("call-center-provider-webhook-drain");

type RecoveryResult = {
  errorCode?: string;
  outcome: "FAILED" | "IGNORED" | "PROCESSED";
};

export function createProviderWebhookDrainer({
  backlog,
  concurrency = 4,
  limit = 20,
  processRecord,
}: {
  backlog: { listDue(limit: number): Promise<ProviderWebhookRecord[]> };
  concurrency?: number;
  limit?: number;
  processRecord(event: ProviderWebhookRecord): Promise<RecoveryResult>;
}) {
  return async function drainProviderWebhooks() {
    const events = await backlog.listDue(limit);
    const groups = new Map<
      string,
      Array<{ event: ProviderWebhookRecord; index: number }>
    >();
    events.forEach((event, index) => {
      const key = event.providerCallSessionId ?? event.id;
      const group = groups.get(key) ?? [];
      group.push({ event, index });
      groups.set(key, group);
    });
    const pendingGroups = [...groups.values()];
    const results: RecoveryResult[] = new Array(events.length);
    let nextGroup = 0;

    async function processGroupsWorker() {
      while (nextGroup < pendingGroups.length) {
        const group = pendingGroups[nextGroup];
        nextGroup += 1;
        if (!group) return;
        for (const { event, index } of group) {
          try {
            results[index] = await processRecord(event);
          } catch {
            results[index] = {
              errorCode: "PROVIDER_EVENT_RECOVERY_FAILED",
              outcome: "FAILED",
            };
          }
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(Math.max(1, Math.floor(concurrency)), pendingGroups.length) },
        () => processGroupsWorker(),
      ),
    );
    results.forEach((result, index) => {
      if (result.outcome !== "FAILED") return;
      logger.error("provider event recovery failed", {
        errorCode: result.errorCode ?? "PROVIDER_EVENT_RECOVERY_FAILED",
        providerEventId: events[index]?.providerEventId,
      });
    });
    const failed = results.filter(({ outcome }) => outcome === "FAILED").length;
    return {
      attempted: events.length,
      failed,
      processed: events.length - failed,
    };
  };
}
