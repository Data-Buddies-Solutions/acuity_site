import {
  decideInboundRouting,
  type RoutingDecision,
  type RoutingQueueSnapshot,
  type RoutingSessionCandidate,
  type RoutingSelection,
} from "@/lib/call-center/domain/routing-decision";

export const ACTIVE_INBOUND_ROUTING_EVENT = "CALL_ROUTING_ACTIVE_STARTED";

type ActiveCallStatus =
  | "RECEIVED"
  | "QUEUED"
  | "RINGING"
  | "CONNECTED"
  | "COMPLETED"
  | "VOICEMAIL"
  | "ABANDONED"
  | "FAILED";

const routableCallStatuses = new Set<ActiveCallStatus>(["RECEIVED", "QUEUED", "RINGING"]);

type ActiveRoutingQueueSnapshot = Omit<RoutingQueueSnapshot, "members"> & {
  members: Array<{
    enabled: boolean;
    sessions: Array<RoutingSessionCandidate & { stateVersion: number }>;
    userId: string;
  }>;
};

export type ActiveRoutingContext = {
  callId: string;
  direction: "INBOUND" | "OUTBOUND";
  effectOwner: "LEGACY" | "CANONICAL";
  practiceId: string;
  queue: ActiveRoutingQueueSnapshot | null;
  status: ActiveCallStatus;
};

export type ActiveRoutingDial = RoutingSelection & {
  commandId: string;
  legId: string;
};

export type ActiveRoutingEventData = RoutingDecision & {
  answerCommandId: string;
  commandIds: string[];
  deadlineAt: string;
  dialCommandIds: string[];
  routed: ActiveRoutingDial[];
  startRingbackCommandId: string;
  stateVersion: number;
};

export type ActiveRoutingDecisionEvent = {
  data: unknown;
  occurredAt: Date;
  revision: bigint;
};

export type ActiveRoutingReceipt = ActiveRoutingEventData & {
  callId: string;
  occurredAt: string;
  replayed: boolean;
  revision: string;
};

export type ActiveRoutingSkipped = {
  callId: string;
  reason:
    "CALL_NOT_CANONICAL" | "CALL_NOT_ROUTABLE" | "OUTBOUND_CALL" | "QUEUE_NOT_ASSIGNED";
  status: "SKIPPED";
};

export interface ActiveRoutingTransaction {
  findRouting(
    practiceId: string,
    callId: string,
  ): Promise<ActiveRoutingDecisionEvent | null>;
  loadContext(practiceId: string, callId: string): Promise<ActiveRoutingContext | null>;
  startRouting(
    context: ActiveRoutingContext & { queue: NonNullable<ActiveRoutingContext["queue"]> },
    decision: RoutingDecision,
    prerequisite: ActiveRoutingPrerequisite | undefined,
    routingKey: string,
    now: Date,
  ): Promise<ActiveRoutingDecisionEvent>;
}

export interface ActiveRoutingStore {
  withCallLock<T>(
    practiceId: string,
    callId: string,
    work: (transaction: ActiveRoutingTransaction) => Promise<T>,
  ): Promise<T>;
}

export type ActiveRoutingPrerequisite = {
  answerCommandId: string;
  startRingbackCommandId: string;
};

export class ActiveRoutingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ActiveRoutingError";
  }
}

function receiptFromEvent(
  callId: string,
  event: ActiveRoutingDecisionEvent,
  replayed: boolean,
): ActiveRoutingReceipt {
  const data = event.data as Partial<ActiveRoutingEventData>;
  if (
    typeof data.queueId !== "string" ||
    !Array.isArray(data.eligible) ||
    !data.exclusions ||
    typeof data.answerCommandId !== "string" ||
    !Array.isArray(data.commandIds) ||
    typeof data.startRingbackCommandId !== "string" ||
    !Array.isArray(data.dialCommandIds) ||
    !Array.isArray(data.routed) ||
    typeof data.deadlineAt !== "string" ||
    typeof data.stateVersion !== "number"
  ) {
    throw new ActiveRoutingError("Stored active routing receipt is invalid", 500);
  }

  const receipt = data as ActiveRoutingEventData;
  return {
    ...receipt,
    callId,
    occurredAt: event.occurredAt.toISOString(),
    replayed,
    revision: event.revision.toString(),
  };
}

/**
 * Persists canonical inbound routing intent under one call lock. Provider I/O
 * is deliberately outside this boundary; callers receive only committed IDs.
 */
export function routeActiveInboundCall(
  store: ActiveRoutingStore,
  input: {
    callId: string;
    practiceId: string;
    prerequisite?: ActiveRoutingPrerequisite;
    routingKey?: string;
  },
  now = new Date(),
): Promise<ActiveRoutingReceipt | ActiveRoutingSkipped> {
  return store.withCallLock(input.practiceId, input.callId, async (transaction) => {
    const routingKey = input.routingKey ?? input.callId;
    const existing = await transaction.findRouting(input.practiceId, routingKey);
    if (existing) return receiptFromEvent(input.callId, existing, true);

    const context = await transaction.loadContext(input.practiceId, input.callId);
    if (!context) throw new ActiveRoutingError("Canonical call not found", 404);
    if (context.direction !== "INBOUND") {
      return { callId: context.callId, reason: "OUTBOUND_CALL", status: "SKIPPED" };
    }
    if (context.effectOwner !== "CANONICAL") {
      return {
        callId: context.callId,
        reason: "CALL_NOT_CANONICAL",
        status: "SKIPPED",
      };
    }
    if (!routableCallStatuses.has(context.status)) {
      return {
        callId: context.callId,
        reason: "CALL_NOT_ROUTABLE",
        status: "SKIPPED",
      };
    }
    if (!context.queue) {
      return {
        callId: context.callId,
        reason: "QUEUE_NOT_ASSIGNED",
        status: "SKIPPED",
      };
    }
    const event = await transaction.startRouting(
      context as ActiveRoutingContext & {
        queue: NonNullable<ActiveRoutingContext["queue"]>;
      },
      decideInboundRouting(context.queue, now),
      input.prerequisite,
      routingKey,
      now,
    );
    return receiptFromEvent(context.callId, event, false);
  });
}
