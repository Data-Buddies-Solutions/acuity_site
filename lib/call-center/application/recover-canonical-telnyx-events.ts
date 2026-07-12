import { processCanonicalTelnyxEvent } from "@/lib/call-center/application/project-canonical-telnyx-event";
import {
  recoverShadowRoutingDecisions,
  type ShadowRoutingRecoveryResult,
} from "@/lib/call-center/application/recover-shadow-routing";
import { canonicalProjectionInbox } from "@/lib/call-center/infrastructure/canonical-provider-webhook-inbox";
import { resolveCanonicalProjectionConfig } from "@/lib/call-center/infrastructure/canonical-projection-config";

const RECOVERY_BATCH_SIZE = 5;

export type CanonicalRecoveryResult = {
  enabled: boolean;
  failed: number;
  ignored: number;
  projected: number;
  selected: number;
  shadowRouting: ShadowRoutingRecoveryResult;
};

type Dependencies = {
  config?: typeof resolveCanonicalProjectionConfig;
  inbox: Pick<typeof canonicalProjectionInbox, "listRecoverable">;
  processEvent: typeof processCanonicalTelnyxEvent;
  shadowRecovery?: () => Promise<ShadowRoutingRecoveryResult>;
};

const noShadowRecovery = (): ShadowRoutingRecoveryResult => ({
  failed: 0,
  remaining: 0,
  recorded: 0,
  replayed: 0,
  selected: 0,
  skipped: 0,
});

export function createCanonicalTelnyxRecovery({
  config = resolveCanonicalProjectionConfig,
  inbox,
  processEvent,
  shadowRecovery = recoverShadowRoutingDecisions,
}: Dependencies) {
  return async function recoverCanonicalTelnyxEvents(): Promise<CanonicalRecoveryResult> {
    if (!config().enabled) {
      return {
        enabled: false,
        failed: 0,
        ignored: 0,
        projected: 0,
        selected: 0,
        shadowRouting: noShadowRecovery(),
      };
    }

    const events = await inbox.listRecoverable(RECOVERY_BATCH_SIZE);
    let failed = 0;
    let ignored = 0;
    let projected = 0;

    for (const event of events) {
      const result = await processEvent(event.id);
      failed += result.outcome === "FAILED" ? 1 : 0;
      ignored += result.outcome === "IGNORED" ? 1 : 0;
      projected += result.outcome === "PROCESSED" ? 1 : 0;
    }

    return {
      enabled: true,
      failed,
      ignored,
      projected,
      selected: events.length,
      shadowRouting: await shadowRecovery(),
    };
  };
}

export const recoverCanonicalTelnyxEvents = createCanonicalTelnyxRecovery({
  inbox: canonicalProjectionInbox,
  processEvent: processCanonicalTelnyxEvent,
});
