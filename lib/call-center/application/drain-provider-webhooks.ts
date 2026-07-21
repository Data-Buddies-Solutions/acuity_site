import type { ProviderWebhookRecord } from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import { createLogger } from "@/lib/logger";

const logger = createLogger("call-center-provider-webhook-drain");

type RecoveryResult = {
  errorCode?: string;
  outcome: "FAILED" | "IGNORED" | "PROCESSED";
};

export function createProviderWebhookDrainer({
  backlog,
  limit = 50,
  processRecord,
}: {
  backlog: { listDue(limit: number): Promise<ProviderWebhookRecord[]> };
  limit?: number;
  processRecord(event: ProviderWebhookRecord): Promise<RecoveryResult>;
}) {
  return async function drainProviderWebhooks() {
    const events = await backlog.listDue(limit);
    const results = await Promise.all(
      events.map(async (event) => {
        try {
          return await processRecord(event);
        } catch {
          return {
            errorCode: "PROVIDER_EVENT_RECOVERY_FAILED",
            outcome: "FAILED" as const,
          };
        }
      }),
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
