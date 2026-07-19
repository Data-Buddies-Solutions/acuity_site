import { describe, expect, it } from "bun:test";

import type {
  ActiveRoutingContext,
  ActiveRoutingEventData,
  ActiveRoutingStore,
  ActiveRoutingTransaction,
} from "@/lib/call-center/application/active-inbound-routing";
import {
  ACTIVE_INBOUND_ROUTING_EVENT,
  routeActiveInboundCall,
} from "@/lib/call-center/application/active-inbound-routing";

const now = new Date("2026-07-12T12:00:00.000Z");

function context(overrides: Partial<ActiveRoutingContext> = {}): ActiveRoutingContext {
  return {
    callId: "call-1",
    direction: "INBOUND",
    practiceId: "practice-1",
    queue: {
      enabled: true,
      id: "queue-1",
      locationIds: ["location-1"],
      members: [
        {
          enabled: true,
          sessions: [
            {
              audioReady: true,
              connectionState: "READY",
              endpoint: {
                configured: true,
                enabled: true,
                id: "endpoint-1",
                locationId: "location-1",
              },
              id: "session-1",
              leaseExpiresAt: new Date(now.getTime() + 60_000),
              microphoneReady: true,
              occupied: false,
              presence: "AVAILABLE",
              stateVersion: 2,
            },
          ],
          userId: "user-1",
        },
      ],
    },
    status: "RECEIVED",
    ...overrides,
  };
}

function fakeTransaction(current = context()) {
  const calls: string[] = [];
  let stored: {
    data: ActiveRoutingEventData;
    occurredAt: Date;
    revision: bigint;
  } | null = null;
  const transaction: ActiveRoutingTransaction = {
    findRouting: async () => {
      calls.push("routing.find");
      return stored;
    },
    loadContext: async () => {
      calls.push("context.load");
      return current;
    },
    startRouting: async (_context, decision) => {
      calls.push("routing.start");
      stored = {
        data: {
          ...decision,
          answerCommandId: "command-answer",
          commandIds: ["command-answer", "command-ringback", "command-dial"],
          deadlineAt: "2026-07-12T12:00:20.000Z",
          dialCommandIds: ["command-dial"],
          routed: [
            {
              ...decision.eligible[0]!,
              commandId: "command-dial",
              legId: "leg-1",
            },
          ],
          startRingbackCommandId: "command-ringback",
          stateVersion: 1,
        },
        occurredAt: now,
        revision: BigInt(12),
      };
      return stored;
    },
  };
  return {
    calls,
    get stored() {
      return stored;
    },
    transaction,
  };
}

describe("canonical active inbound routing", () => {
  it("decides readiness and returns only committed command IDs", async () => {
    const fake = fakeTransaction();
    const result = await routeActiveInboundCall(
      {
        withCallLock: (_practiceId, _callId, operation) => operation(fake.transaction),
      },
      { callId: "call-1", practiceId: "practice-1" },
      now,
    );

    expect(fake.calls).toEqual(["routing.find", "context.load", "routing.start"]);
    expect(result).toMatchObject({
      callId: "call-1",
      commandIds: ["command-answer", "command-ringback", "command-dial"],
      dialCommandIds: ["command-dial"],
      replayed: false,
      revision: "12",
    });
  });

  it("replays the one routing event without reloading mutable readiness", async () => {
    const fake = fakeTransaction();
    const store: ActiveRoutingStore = {
      withCallLock: <T>(
        _practiceId: string,
        _callId: string,
        operation: (tx: ActiveRoutingTransaction) => Promise<T>,
      ) => operation(fake.transaction),
    };
    await routeActiveInboundCall(
      store,
      { callId: "call-1", practiceId: "practice-1" },
      now,
    );
    const replay = await routeActiveInboundCall(
      store,
      { callId: "call-1", practiceId: "practice-1" },
      now,
    );

    expect(replay).toMatchObject({ replayed: true, revision: "12" });
    expect(fake.calls).toEqual([
      "routing.find",
      "context.load",
      "routing.start",
      "routing.find",
    ]);
  });

  it("uses an explicit idempotency key for one routing attempt", async () => {
    const fake = fakeTransaction();
    let routingKey = "";
    fake.transaction.findRouting = async (_practiceId, key) => {
      routingKey = key;
      return null;
    };
    await routeActiveInboundCall(
      {
        withCallLock: (_practiceId, _callId, operation) => operation(fake.transaction),
      },
      {
        callId: "call-1",
        practiceId: "practice-1",
        routingKey: "initial:call-1",
      },
      now,
    );
    expect(routingKey).toBe("initial:call-1");
  });

  it("uses a dedicated immutable event type", () => {
    expect(ACTIVE_INBOUND_ROUTING_EVENT).toBe("CALL_ROUTING_ACTIVE_STARTED");
  });
});
