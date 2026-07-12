import { describe, expect, it } from "bun:test";

import { decideInboundRouting } from "@/lib/call-center/domain/routing-decision";

import { createShadowRoutingRecovery } from "../recover-shadow-routing";

const now = new Date("2026-07-12T12:00:00.000Z");

function receipt(replayed: boolean) {
  const decision = decideInboundRouting(
    { enabled: true, id: "queue-1", locationIds: [], members: [] },
    now,
  );
  return {
    callId: "call-1",
    ...decision,
    occurredAt: now.toISOString(),
    replayed,
    revision: "1",
    source: "RECOVERY" as const,
  };
}

describe("shadow routing recovery", () => {
  it("records a bounded batch and isolates individual failures", async () => {
    const selected = [
      { callId: "call-1", practiceId: "practice-1" },
      { callId: "call-2", practiceId: "practice-1" },
      { callId: "call-3", practiceId: "practice-1" },
      { callId: "call-4", practiceId: "practice-1" },
    ];
    let requestedLimit = 0;
    const processed: string[] = [];
    const recover = createShadowRoutingRecovery({
      clock: () => now,
      recordDecision: async (call, recordedAt) => {
        expect(recordedAt).toEqual(now);
        expect(call.source).toBe("RECOVERY");
        processed.push(call.callId);
        if (call.callId === "call-2") return receipt(true);
        if (call.callId === "call-3") {
          return {
            callId: call.callId,
            reason: "ROUTING_MODE_NOT_SHADOW",
            status: "SKIPPED",
          };
        }
        if (call.callId === "call-4") throw new Error("temporary database failure");
        return receipt(false);
      },
      store: {
        countMissingDecisions: async () => 1,
        listMissingDecisions: async (limit) => {
          requestedLimit = limit;
          return selected;
        },
      },
    });

    await expect(recover()).resolves.toEqual({
      failed: 1,
      recorded: 1,
      remaining: 1,
      replayed: 1,
      selected: 4,
      skipped: 1,
    });
    expect(requestedLimit).toBe(5);
    expect(processed).toEqual(["call-1", "call-2", "call-3", "call-4"]);
  });

  it("is a no-op when every active SHADOW call has a receipt", async () => {
    let decisionCalls = 0;
    const recover = createShadowRoutingRecovery({
      recordDecision: async () => {
        decisionCalls += 1;
        return receipt(false);
      },
      store: {
        countMissingDecisions: async () => 0,
        listMissingDecisions: async () => [],
      },
    });

    await expect(recover()).resolves.toEqual({
      failed: 0,
      recorded: 0,
      remaining: 0,
      replayed: 0,
      selected: 0,
      skipped: 0,
    });
    expect(decisionCalls).toBe(0);
  });
});
