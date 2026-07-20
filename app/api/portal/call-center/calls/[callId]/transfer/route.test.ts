import { describe, expect, it } from "bun:test";

import { TransferAgentCallError } from "@/lib/call-center/application/transfer-agent-call";

import { createTransferAgentHandler, createTransferTargetsHandler } from "./handler";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const context = { params: Promise.resolve({ callId: "call-1" }) };

describe("canonical cold transfer route", () => {
  it("lists only the server-authorized available targets", async () => {
    let received: unknown;
    const GET = createTransferTargetsHandler({
      getActor: async () => actor,
      list: async (currentActor, input) => {
        received = { actor: currentActor, input };
        return [{ endpointId: "endpoint-2", label: "Front desk" }];
      },
    });
    const response = await GET(
      new Request(
        "https://example.test/api/portal/call-center/calls/call-1/transfer?clientInstanceId=browser-1",
      ),
      context,
    );
    expect(response.status).toBe(200);
    expect(received).toEqual({
      actor,
      input: { callId: "call-1", clientInstanceId: "browser-1" },
    });
    expect(await response.json()).toEqual({
      targets: [{ endpointId: "endpoint-2", label: "Front desk" }],
    });
  });

  it("persists and dispatches one idempotent transfer command", async () => {
    let saved: unknown;
    const POST = createTransferAgentHandler({
      getActor: async () => actor,
      transfer: async (currentActor, input) => {
        saved = { actor: currentActor, input };
        return {
          callId: input.callId,
          commandId: "command-1",
          occurredAt: "2026-07-19T12:00:00.000Z",
          operationType: "TRANSFER",
          replayed: false,
          revision: "21",
          sourceLegId: "leg-1",
          stateVersion: 4,
          status: "PENDING",
          targetEndpointId: input.targetEndpointId,
          targetLegId: "leg-2",
        };
      },
    });
    const response = await POST(
      new Request("https://example.test", {
        body: JSON.stringify({
          clientInstanceId: "browser-1",
          expectedStateVersion: 3,
          targetEndpointId: "endpoint-2",
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": " transfer-1 ",
        },
        method: "POST",
      }),
      context,
    );
    expect(response.status).toBe(202);
    expect(saved).toEqual({
      actor,
      input: {
        callId: "call-1",
        clientInstanceId: "browser-1",
        expectedStateVersion: 3,
        idempotencyKey: "transfer-1",
        targetEndpointId: "endpoint-2",
      },
    });
  });

  it("translates a transfer failure from the lifecycle owner", async () => {
    const POST = createTransferAgentHandler({
      getActor: async () => actor,
      transfer: async () => {
        throw new TransferAgentCallError("Transfer could not be started", 409);
      },
    });

    const response = await POST(
      new Request("https://example.test", {
        body: JSON.stringify({
          clientInstanceId: "browser-1",
          expectedStateVersion: 3,
          targetEndpointId: "endpoint-2",
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "transfer-1",
        },
        method: "POST",
      }),
      context,
    );

    expect(response.status).toBe(409);
  });
});
