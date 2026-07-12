import { describe, expect, it } from "bun:test";

import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

import { createTransferCallHandler } from "./handler";

const actor: QueueAccessActor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-source",
};
const routeContext = { params: Promise.resolve({ callId: "call-1" }) };

function request(body: unknown, key = "transfer-1") {
  return new Request(
    "https://example.test/api/portal/call-center/calls/call-1/transfer",
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      method: "POST",
    },
  );
}

describe("canonical transfer route", () => {
  it("stops new transfer commands when global activation is off", async () => {
    let calls = 0;
    const POST = createTransferCallHandler({
      getActor: async () => actor,
      isCanonicalActive: () => false,
      transfer: async () => {
        calls += 1;
        throw new Error("not reached");
      },
    });

    const response = await POST(
      request({ targetEndpointId: "target-endpoint-1" }),
      routeContext,
    );

    expect(response.status).toBe(409);
    expect(calls).toBe(0);
  });

  it("uses authenticated scope and schedules only the committed target dial", async () => {
    let captured: unknown;
    const scheduled: string[] = [];
    const POST = createTransferCallHandler({
      getActor: async () => actor,
      isCanonicalActive: () => true,
      scheduleCommand: (id) => scheduled.push(id),
      transfer: async (_store, transferActor, input) => {
        captured = { actor: transferActor, input };
        return {
          callId: input.callId,
          occurredAt: "2026-07-12T12:00:00.000Z",
          operationType: "TRANSFER",
          providerCommandId: "command-1",
          replayed: false,
          revision: "40",
          sourceLegId: "source-leg-1",
          stateVersion: 8,
          status: "PENDING",
          targetAgentSessionId: "target-session-1",
          targetEndpointId: input.targetEndpointId,
          targetLegId: "target-leg-1",
        };
      },
    });

    const response = await POST(
      request({ targetEndpointId: " target-endpoint-1 " }),
      routeContext,
    );
    expect(response.status).toBe(202);
    expect(captured).toEqual({
      actor,
      input: {
        callId: "call-1",
        idempotencyKey: "transfer-1",
        targetEndpointId: "target-endpoint-1",
      },
    });
    expect(scheduled).toEqual(["command-1"]);
  });

  it("replays without scheduling a completed command", async () => {
    const scheduled: string[] = [];
    const POST = createTransferCallHandler({
      getActor: async () => actor,
      isCanonicalActive: () => true,
      scheduleCommand: (id) => scheduled.push(id),
      transfer: async () => ({
        callId: "call-1",
        occurredAt: "2026-07-12T12:00:00.000Z",
        operationType: "TRANSFER",
        providerCommandId: "command-1",
        replayed: true,
        revision: "40",
        sourceLegId: "source-leg-1",
        stateVersion: 8,
        status: "CONFIRMED",
        targetAgentSessionId: "target-session-1",
        targetEndpointId: "target-endpoint-1",
        targetLegId: "target-leg-1",
      }),
    });
    const response = await POST(
      request({ targetEndpointId: "target-endpoint-1" }),
      routeContext,
    );
    expect(response.status).toBe(200);
    expect(scheduled).toEqual([]);
  });

  it("reschedules a replayed pending intent after a lost immediate wakeup", async () => {
    const scheduled: string[] = [];
    const POST = createTransferCallHandler({
      getActor: async () => actor,
      isCanonicalActive: () => true,
      scheduleCommand: (id) => scheduled.push(id),
      transfer: async () => ({
        callId: "call-1",
        occurredAt: "2026-07-12T12:00:00.000Z",
        operationType: "TRANSFER",
        providerCommandId: "command-1",
        replayed: true,
        revision: "40",
        sourceLegId: "source-leg-1",
        stateVersion: 8,
        status: "PENDING",
        targetAgentSessionId: "target-session-1",
        targetEndpointId: "target-endpoint-1",
        targetLegId: "target-leg-1",
      }),
    });

    const response = await POST(
      request({ targetEndpointId: "target-endpoint-1" }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(scheduled).toEqual(["command-1"]);
  });

  it("rejects client-owned scope and missing keys", async () => {
    let calls = 0;
    const POST = createTransferCallHandler({
      getActor: async () => actor,
      isCanonicalActive: () => true,
      transfer: async () => {
        calls += 1;
        throw new Error("not reached");
      },
    });
    const invalidBody = await POST(
      request({ practiceId: "practice-2", targetEndpointId: "endpoint-1" }),
      routeContext,
    );
    const missingKey = await POST(
      new Request("https://example.test/transfer", {
        body: JSON.stringify({ targetEndpointId: "endpoint-1" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      routeContext,
    );
    expect(invalidBody.status).toBe(422);
    expect(missingKey.status).toBe(400);
    expect(calls).toBe(0);
  });
});
