import { describe, expect, it } from "bun:test";

import { StartOutboundCallError } from "@/lib/call-center/application/start-outbound-call";

import { createStartOutboundCallHandler } from "./handler";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};

describe("POST /api/portal/call-center/outbound", () => {
  it("passes only authenticated scope and bounded canonical dial input", async () => {
    let received: unknown;
    const handler = createStartOutboundCallHandler({
      getActor: async () => actor,
      start: async (currentActor, input) => {
        received = { actor: currentActor, input };
        return {
          agentSessionId: "session-1",
          callId: "call-1",
          commandId: "dial-customer-1",
          customerLegId: "customer-leg-1",
          endpointId: "endpoint-1",
          legId: "leg-1",
          occurredAt: "2026-07-12T18:00:00.000Z",
          operationType: "OUTBOUND",
          replayed: false,
          revision: "42",
          stateVersion: 0,
        };
      },
    });
    const response = await handler(
      new Request("http://localhost/api/portal/call-center/outbound", {
        body: JSON.stringify({
          clientInstanceId: "browser-1",
          destination: "+15555550123",
          numberId: "number-1",
          queueId: "queue-1",
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": " operation-1 ",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(201);
    expect(received).toEqual({
      actor,
      input: {
        clientInstanceId: "browser-1",
        destination: "+15555550123",
        idempotencyKey: "operation-1",
        numberId: "number-1",
        queueId: "queue-1",
      },
    });
    expect(await response.json()).toEqual(
      expect.objectContaining({
        callId: "call-1",
        commandId: "dial-customer-1",
        customerLegId: "customer-leg-1",
      }),
    );
  });

  it("requires an idempotency key and rejects legacy fields", async () => {
    const handler = createStartOutboundCallHandler({
      getActor: async () => actor,
      start: async () => {
        throw new Error("must not run");
      },
    });
    const response = await handler(
      new Request("http://localhost/api/portal/call-center/outbound", {
        body: JSON.stringify({
          callControlId: "legacy-call",
          clientInstanceId: "browser-1",
          destination: "+15555550123",
          endpointId: "endpoint-1",
          expectedSessionStateVersion: 2,
          fromPhone: "+15555550000",
          numberId: "number-1",
          queueId: "queue-1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(422);
  });

  it("marks a confirmed provider rejection as terminal", async () => {
    const handler = createStartOutboundCallHandler({
      getActor: async () => actor,
      start: async () => {
        throw new StartOutboundCallError(
          "Outbound call was rejected by phone service",
          502,
          false,
        );
      },
    });
    const response = await handler(
      new Request("http://localhost/api/portal/call-center/outbound", {
        body: JSON.stringify({
          clientInstanceId: "browser-1",
          destination: "+15555550123",
          numberId: "number-1",
          queueId: "queue-1",
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "operation-1",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: "OUTBOUND_CALL_FAILED", retryable: false },
    });
  });
});
