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
  it("passes only authenticated identity and bounded canonical input", async () => {
    let captured: unknown;
    const POST = createClaimCallHandler({
      claim: async (_store, claimActor, input) => {
        captured = { actor: claimActor, input };
        return {
          callId: input.callId,
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
  });

  it("returns the original receipt for an exact replay", async () => {
    const POST = createClaimCallHandler({
      claim: async () => ({
        callId: "call-1",
        occurredAt: "2026-07-12T12:00:00.000Z",
        operationType: "CLAIM",
        providerCommandId: "command-1",
        replayed: true,
        revision: "12",
        stateVersion: 3,
        status: "CONFIRMED",
      }),
      getActor: async () => actor,
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
  });

  it("rejects a missing idempotency key and client-owned scope", async () => {
    let calls = 0;
    const POST = createClaimCallHandler({
      claim: async () => {
        calls += 1;
        throw new Error("must not run");
      },
      getActor: async () => actor,
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
