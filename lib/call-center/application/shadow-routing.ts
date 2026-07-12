import {
  decideInboundRouting,
  type RoutingDecision,
  type RoutingQueueSnapshot,
} from "@/lib/call-center/domain/routing-decision";

export const SHADOW_ROUTING_DECISION_EVENT = "CALL_ROUTING_SHADOW_DECIDED";

export type ShadowRoutingContext = {
  callId: string;
  direction: "INBOUND" | "OUTBOUND";
  practiceId: string;
  queue: (RoutingQueueSnapshot & { routingMode: "LEGACY" | "SHADOW" | "ACTIVE" }) | null;
};

export type ShadowRoutingDecisionEvent = {
  data: unknown;
  occurredAt: Date;
  revision: bigint;
};

export type ShadowRoutingReceipt = RoutingDecision & {
  callId: string;
  occurredAt: string;
  replayed: boolean;
  revision: string;
};

export type ShadowRoutingSkipped = {
  callId: string;
  reason: "OUTBOUND_CALL" | "QUEUE_NOT_ASSIGNED" | "ROUTING_MODE_NOT_SHADOW";
  status: "SKIPPED";
};

export interface ShadowRoutingTransaction {
  appendDecision(
    context: ShadowRoutingContext,
    decision: RoutingDecision,
    now: Date,
  ): Promise<ShadowRoutingDecisionEvent>;
  findDecision(
    practiceId: string,
    callId: string,
  ): Promise<ShadowRoutingDecisionEvent | null>;
  loadContext(practiceId: string, callId: string): Promise<ShadowRoutingContext | null>;
}

export interface ShadowRoutingStore {
  withCallLock<T>(
    practiceId: string,
    callId: string,
    work: (transaction: ShadowRoutingTransaction) => Promise<T>,
  ): Promise<T>;
}

export class ShadowRoutingError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ShadowRoutingError";
    this.status = status;
  }
}

function receiptFromEvent(
  callId: string,
  event: ShadowRoutingDecisionEvent,
  replayed: boolean,
): ShadowRoutingReceipt {
  const decision = event.data as Partial<RoutingDecision>;
  if (
    decision.queueId === undefined ||
    !Array.isArray(decision.eligible) ||
    !decision.exclusions
  ) {
    throw new ShadowRoutingError("Stored shadow routing receipt is invalid", 500);
  }
  return {
    callId,
    eligible: decision.eligible,
    exclusions: decision.exclusions,
    occurredAt: event.occurredAt.toISOString(),
    queueId: decision.queueId,
    replayed,
    revision: event.revision.toString(),
  };
}

/**
 * Records one immutable decision-only receipt for an inbound SHADOW call.
 * The store locks the call, so retries and concurrent workers see one event.
 * No command or provider adapter exists on this boundary by design.
 */
export function recordShadowRoutingDecision(
  store: ShadowRoutingStore,
  input: { callId: string; practiceId: string },
  now = new Date(),
): Promise<ShadowRoutingReceipt | ShadowRoutingSkipped> {
  return store.withCallLock(input.practiceId, input.callId, async (transaction) => {
    const context = await transaction.loadContext(input.practiceId, input.callId);
    if (!context) throw new ShadowRoutingError("Canonical call not found", 404);
    const existing = await transaction.findDecision(context.practiceId, context.callId);
    if (existing) return receiptFromEvent(context.callId, existing, true);
    if (context.direction !== "INBOUND") {
      return { callId: context.callId, reason: "OUTBOUND_CALL", status: "SKIPPED" };
    }
    if (!context.queue) {
      return {
        callId: context.callId,
        reason: "QUEUE_NOT_ASSIGNED",
        status: "SKIPPED",
      };
    }
    if (context.queue.routingMode !== "SHADOW") {
      return {
        callId: context.callId,
        reason: "ROUTING_MODE_NOT_SHADOW",
        status: "SKIPPED",
      };
    }

    const decision = decideInboundRouting(context.queue, now);
    const event = await transaction.appendDecision(context, decision, now);
    return receiptFromEvent(context.callId, event, false);
  });
}
