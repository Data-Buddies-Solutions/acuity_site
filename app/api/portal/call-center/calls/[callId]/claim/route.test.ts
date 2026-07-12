import { describe, expect, it } from "bun:test";

import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

import { createClaimCallHandler } from "./handler";

const actor: QueueAccessActor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const routeContext = { params: Promise.resolve({ callId: "call-1" }) };

function request(body: unknown, idempotencyKey?: string) {
  return new Request("https://example.test/api/portal/call-center/calls/call-1/claim", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    method: "POST",
  });
}

describe("canonical claim route", () => {
  it("stops new claim commands when global activation is off", async () => {
    let calls = 0;
    const POST = createClaimCallHandler({
      claim: async () => {
        calls += 1;
        throw new Error("must not run");
      },
      getActor: async () => actor,
      isCanonicalActive: () => false,
    });

    const response = await POST(
      request(
        {
          clientInstanceId: "browser-1",
          endpointId: "endpoint-1",
          expectedSessionStateVersion: 2,
        },
        "operation-1",
      ),
      routeContext,
    );

    expect(response.status).toBe(409);
    expect(calls).toBe(0);
  });

  it("passes only authenticated identity and bounded canonical input", async () => {
    let captured: unknown;
    const scheduled: string[] = [];
    const POST = createClaimCallHandler({
      claim: async (_store, claimActor, input) => {
        captured = { actor: claimActor, input };
        return {
          agentSessionId: "session-1",
          callId: input.callId,
          endpointId: "endpoint-1",
          legId: "leg-1",
          occurredAt: "2026-07-12T12:00:00.000Z",
          operationType: "CLAIM",
          providerCommandId: "command-1",
          replayed: false,
          revision: "12",
          stateVersion: 3,
          status: "PENDING",
        };
      },
      getActor: async () => actor,
      isCanonicalActive: () => true,
      scheduleCommand: (commandId) => scheduled.push(commandId),
    });
    const response = await POST(
      request(
        {
          clientInstanceId: " browser-1 ",
          endpointId: " endpoint-1 ",
          expectedSessionStateVersion: 2,
        },
        " operation-1 ",
      ),
      routeContext,
    );

    expect(response.status).toBe(202);
    expect(captured).toEqual({
      actor,
      input: {
        callId: "call-1",
        clientInstanceId: "browser-1",
        endpointId: "endpoint-1",
        expectedSessionStateVersion: 2,
        idempotencyKey: "operation-1",
      },
    });
    expect(scheduled).toEqual(["command-1"]);
  });

  it("returns the original receipt for an exact replay", async () => {
    const scheduled: string[] = [];
    const POST = createClaimCallHandler({
      claim: async () => ({
        agentSessionId: "session-1",
        callId: "call-1",
        endpointId: "endpoint-1",
        legId: "leg-1",
        occurredAt: "2026-07-12T12:00:00.000Z",
        operationType: "CLAIM",
        providerCommandId: "command-1",
        replayed: true,
        revision: "12",
        stateVersion: 3,
        status: "CONFIRMED",
      }),
      getActor: async () => actor,
      isCanonicalActive: () => true,
      scheduleCommand: (commandId) => scheduled.push(commandId),
    });

    const response = await POST(
      request(
        {
          clientInstanceId: "browser-1",
          endpointId: "endpoint-1",
          expectedSessionStateVersion: 2,
        },
        "operation-1",
      ),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replayed: true, revision: "12" });
    expect(scheduled).toEqual([]);
  });

  it("reschedules a pending replay while cron remains the durable fallback", async () => {
    const scheduled: string[] = [];
    const POST = createClaimCallHandler({
      claim: async () => ({
        agentSessionId: "session-1",
        callId: "call-1",
        endpointId: "endpoint-1",
        legId: "leg-1",
        occurredAt: "2026-07-12T12:00:00.000Z",
        operationType: "CLAIM",
        providerCommandId: "command-1",
        replayed: true,
        revision: "12",
        stateVersion: 3,
        status: "PENDING",
      }),
      getActor: async () => actor,
      isCanonicalActive: () => true,
      scheduleCommand: (commandId) => scheduled.push(commandId),
    });

    const response = await POST(
      request(
        {
          clientInstanceId: "browser-1",
          endpointId: "endpoint-1",
          expectedSessionStateVersion: 2,
        },
        "operation-1",
      ),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(scheduled).toEqual(["command-1"]);
  });

  it("rejects a missing idempotency key and client-owned scope", async () => {
    let calls = 0;
    const POST = createClaimCallHandler({
      claim: async () => {
        calls += 1;
        throw new Error("must not run");
      },
      getActor: async () => actor,
      isCanonicalActive: () => true,
    });
    const missingKey = await POST(
      request({
        clientInstanceId: "browser-1",
        endpointId: "endpoint-1",
        expectedSessionStateVersion: 2,
      }),
      routeContext,
    );
    const clientScope = await POST(
      request(
        {
          clientInstanceId: "browser-1",
          endpointId: "endpoint-1",
          expectedSessionStateVersion: 2,
          practiceId: "practice-2",
        },
        "operation-1",
      ),
      routeContext,
    );

    expect(missingKey.status).toBe(400);
    expect(clientScope.status).toBe(422);
    expect(calls).toBe(0);
  });
});
