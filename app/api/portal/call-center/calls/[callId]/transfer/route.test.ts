import { describe, expect, it } from "bun:test";

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
      list: async (_store, currentActor, input) => {
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
    const dispatched: string[] = [];
    const POST = createTransferAgentHandler({
      dispatch: async (commandId) => {
        dispatched.push(commandId);
        return { commandId, markSent: "MARKED", status: "DISPATCHED" };
      },
      getActor: async () => actor,
      save: async (_store, currentActor, input) => {
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
    expect(dispatched).toEqual(["command-1"]);
  });

  it("dispatches transfer-failure cleanup before returning the error", async () => {
    const dispatched: string[] = [];
    const POST = createTransferAgentHandler({
      dispatch: async (commandId) => {
        dispatched.push(commandId);
        return commandId === "command-1"
          ? {
              commandId,
              errorCode: "PROVIDER_VALIDATION_FAILED",
              followUpCommandIds: ["cleanup-1"],
              status: "FAILED",
            }
          : { commandId, markSent: "MARKED", status: "DISPATCHED" };
      },
      getActor: async () => actor,
      save: async (_store, _actor, input) => ({
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
      }),
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
    expect(dispatched).toEqual(["command-1", "cleanup-1"]);
  });
});
