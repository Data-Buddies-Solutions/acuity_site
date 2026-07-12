import type { ActiveInboundLifecycleDecision } from "@/lib/call-center/domain/active-inbound-lifecycle";

export type ActiveInboundReconciliationInput = {
  callId: string;
  practiceId: string;
  processedBridgeLegId: string | null;
};

export type ActiveInboundReconciliationResult =
  | {
      callId: string;
      commandIds: string[];
      decision: ActiveInboundLifecycleDecision | null;
      status: "APPLIED" | "SKIPPED";
    }
  | {
      callId: string;
      commandIds: [];
      decision: null;
      errorCode: "ACTIVE_INBOUND_RECONCILIATION_FAILED";
      status: "FAILED";
    };

export type ActiveInboundReconciliationSuccess = Exclude<
  ActiveInboundReconciliationResult,
  { status: "FAILED" }
>;

export type ActiveInboundLifecycleRecoveryResult = {
  abandoned: number;
  connected: number;
  failed: number;
  overflowed: number;
  selected: number;
  skipped: number;
  voicemail: number;
  waiting: number;
};

export interface ActiveInboundReconciliationStore {
  reconcile(
    input: ActiveInboundReconciliationInput,
    now: Date,
  ): Promise<ActiveInboundReconciliationResult>;
  reconcileDue(input: {
    limit: number;
    now: Date;
  }): Promise<ActiveInboundReconciliationResult[]>;
}

export function reconcileActiveInboundCall(
  store: ActiveInboundReconciliationStore,
  input: ActiveInboundReconciliationInput,
  now = new Date(),
) {
  return store.reconcile(input, now);
}

const RECOVERY_BATCH_SIZE = 5;

export function createActiveInboundLifecycleRecovery({
  clock = () => new Date(),
  store,
}: {
  clock?: () => Date;
  store: ActiveInboundReconciliationStore;
}) {
  return async function recoverActiveInboundLifecycle(): Promise<ActiveInboundLifecycleRecoveryResult> {
    const results = await store.reconcileDue({
      limit: RECOVERY_BATCH_SIZE,
      now: clock(),
    });
    const counts: ActiveInboundLifecycleRecoveryResult = {
      abandoned: 0,
      connected: 0,
      failed: 0,
      overflowed: 0,
      selected: results.length,
      skipped: 0,
      voicemail: 0,
      waiting: 0,
    };

    for (const result of results) {
      if (result.status === "FAILED") {
        counts.failed += 1;
        continue;
      }
      if (result.status === "SKIPPED" || !result.decision) {
        counts.skipped += 1;
        continue;
      }

      switch (result.decision.disposition) {
        case "ABANDONED":
          counts.abandoned += 1;
          break;
        case "CONNECTED":
          counts.connected += 1;
          break;
        case "OVERFLOW":
          counts.overflowed += 1;
          break;
        case "VOICEMAIL":
          counts.voicemail += 1;
          break;
        case "WAITING_FOR_AGENT":
          counts.waiting += 1;
          break;
      }
    }

    return counts;
  };
}
