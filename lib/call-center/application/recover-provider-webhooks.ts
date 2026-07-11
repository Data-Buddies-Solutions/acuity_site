import {
  providerWebhookInbox,
  type ProviderWebhookInbox,
} from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import {
  resolveDurableWebhookIngressConfig,
  type DurableWebhookIngressConfig,
} from "@/lib/call-center/infrastructure/durable-ingress-config";
import { parseTelnyxVoiceWebhookEnvelope } from "@/lib/call-center/infrastructure/telnyx-voice-envelope";

import { processTelnyxVoiceEvent } from "./process-telnyx-voice-event";

const RECOVERY_BATCH_SIZE = 5;
const REDACTION_BATCH_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1_000;

type RecoveryInbox = Pick<ProviderWebhookInbox, "listRecoverable" | "redactPayloads">;

type ProviderWebhookRecoveryDependencies = {
  clock?: () => Date;
  config?: () => DurableWebhookIngressConfig;
  inbox: RecoveryInbox;
  processEvent: typeof processTelnyxVoiceEvent;
};

export type ProviderWebhookRecoveryResult = {
  enabled: boolean;
  failed: number;
  recovered: number;
  redacted: number;
  selected: number;
};

/**
 * Bounded recovery lane for durable Telnyx voice events. Event failures are
 * isolated so one malformed or temporarily failing projection cannot block the
 * rest of the batch. The result deliberately contains aggregate counts only.
 */
export function createProviderWebhookRecovery({
  clock = () => new Date(),
  config = resolveDurableWebhookIngressConfig,
  inbox,
  processEvent,
}: ProviderWebhookRecoveryDependencies) {
  return async function recoverProviderWebhooks(): Promise<ProviderWebhookRecoveryResult> {
    const durableIngress = config();

    if (durableIngress.payloadRetentionDays === null) {
      return {
        enabled: false,
        failed: 0,
        recovered: 0,
        redacted: 0,
        selected: 0,
      };
    }

    const now = clock();
    const events = durableIngress.enabled
      ? await inbox.listRecoverable(RECOVERY_BATCH_SIZE)
      : [];
    let recovered = 0;
    let failed = 0;

    for (const event of events) {
      try {
        await processEvent(parseTelnyxVoiceWebhookEnvelope(event.payload));
        recovered += 1;
      } catch {
        failed += 1;
      }
    }

    const before = new Date(now.getTime() - durableIngress.payloadRetentionDays * DAY_MS);
    const redacted = await inbox.redactPayloads({
      before,
      limit: REDACTION_BATCH_SIZE,
    });

    return {
      enabled: durableIngress.enabled,
      failed,
      recovered,
      redacted,
      selected: events.length,
    };
  };
}

export const recoverProviderWebhooks = createProviderWebhookRecovery({
  inbox: providerWebhookInbox,
  processEvent: processTelnyxVoiceEvent,
});
