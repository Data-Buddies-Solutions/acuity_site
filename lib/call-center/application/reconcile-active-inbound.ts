import type { ActiveInboundLifecycleDecision } from "@/lib/call-center/domain/active-inbound-lifecycle";

export type ActiveInboundReconciliationInput = {
  callId: string;
  practiceId: string;
  processedBridgeLegId: string | null;
};

type ActiveInboundReconciliationResult =
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
