import {
  recordShadowRoutingDecision,
  type ShadowRoutingReceipt,
  type ShadowRoutingSkipped,
} from "@/lib/call-center/application/shadow-routing";
import { prismaShadowRoutingStore } from "@/lib/call-center/infrastructure/prisma-shadow-routing-store";

const RECOVERY_BATCH_SIZE = 5;

export type ShadowRoutingRecoveryCandidate = {
  callId: string;
  practiceId: string;
};

export type ShadowRoutingRecoveryResult = {
  failed: number;
  remaining: number;
  recorded: number;
  replayed: number;
  selected: number;
  skipped: number;
};

export interface ShadowRoutingRecoveryStore {
  countMissingDecisions(): Promise<number>;
  listMissingDecisions(limit: number): Promise<ShadowRoutingRecoveryCandidate[]>;
}

type Dependencies = {
  clock?: () => Date;
  recordDecision: (
    input: ShadowRoutingRecoveryCandidate & { source: "RECOVERY" },
    now: Date,
  ) => Promise<ShadowRoutingReceipt | ShadowRoutingSkipped>;
  store: ShadowRoutingRecoveryStore;
};

/**
 * Retries a bounded batch of non-terminal SHADOW calls whose post-projection
 * decision receipt was not committed. Per-call locking keeps concurrent cron
 * invocations and projection retries idempotent.
 */
export function createShadowRoutingRecovery({
  clock = () => new Date(),
  recordDecision,
  store,
}: Dependencies) {
  return async function recoverShadowRoutingDecisions(): Promise<ShadowRoutingRecoveryResult> {
    const calls = await store.listMissingDecisions(RECOVERY_BATCH_SIZE);
    let failed = 0;
    let recorded = 0;
    let replayed = 0;
    let skipped = 0;

    for (const call of calls) {
      try {
        const result = await recordDecision({ ...call, source: "RECOVERY" }, clock());
        if ("status" in result) skipped += 1;
        else if (result.replayed) replayed += 1;
        else recorded += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      failed,
      recorded,
      remaining: await store.countMissingDecisions(),
      replayed,
      selected: calls.length,
      skipped,
    };
  };
}

export const recoverShadowRoutingDecisions = createShadowRoutingRecovery({
  recordDecision: (input, now) =>
    recordShadowRoutingDecision(prismaShadowRoutingStore, input, now),
  store: prismaShadowRoutingStore,
});
