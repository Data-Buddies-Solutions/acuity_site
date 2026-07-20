import { describe, expect, it } from "bun:test";

import {
  callCenter,
  createCallCenter,
  startCanonicalOutbound,
  startCanonicalTransfer,
} from "../call-center";

describe("server Call Center module", () => {
  it("settles inbound offers before creating an outbound call", async () => {
    const calls: string[] = [];
    const result = await startCanonicalOutbound(
      {
        create: async () => {
          calls.push("create");
          return { callId: "outbound-1" };
        },
        dispatch: async (commandId) => {
          calls.push(`dispatch:${commandId}`);
          return { commandId, markSent: "MARKED", status: "DISPATCHED" };
        },
        prepare: async () => {
          calls.push("prepare");
          return ["hangup-1"];
        },
      },
      {
        allowedLocationIds: [],
        hasAllLocationAccess: true,
        practiceId: "practice-1",
        userId: "user-1",
      },
      {
        clientInstanceId: "browser-1",
        destination: "+15555550123",
        idempotencyKey: "operation-1",
        numberId: "number-1",
        queueId: "queue-1",
      },
    );

    expect(calls).toEqual(["prepare", "dispatch:hangup-1", "create"]);
    expect(result).toEqual({ callId: "outbound-1" });
  });

  it("does not create outbound intent while offer cleanup is unresolved", async () => {
    let created = false;
    await expect(
      startCanonicalOutbound(
        {
          create: async () => {
            created = true;
          },
          dispatch: async (commandId) => ({
            commandId,
            errorCode: "SENDING_OUTCOME_AMBIGUOUS",
            status: "DEFERRED",
          }),
          prepare: async () => ["hangup-1"],
        },
        {
          allowedLocationIds: [],
          hasAllLocationAccess: true,
          practiceId: "practice-1",
          userId: "user-1",
        },
        {
          clientInstanceId: "browser-1",
          destination: "+15555550123",
          idempotencyKey: "operation-1",
          numberId: "number-1",
          queueId: "queue-1",
        },
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(created).toBe(false);
  });

  it("dispatches transfer recovery before surfacing a failed transfer", async () => {
    const dispatched: string[] = [];
    await expect(
      startCanonicalTransfer(
        {
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
          save: async (_actor, input) => ({
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
        },
        {
          allowedLocationIds: [],
          hasAllLocationAccess: true,
          practiceId: "practice-1",
          userId: "user-1",
        },
        {
          callId: "call-1",
          clientInstanceId: "browser-1",
          expectedStateVersion: 3,
          idempotencyKey: "transfer-1",
          targetEndpointId: "endpoint-2",
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(dispatched).toEqual(["command-1", "cleanup-1"]);
  });

  it("owns direct handoff configuration and expiry behind one logical operation", async () => {
    let captured: unknown;
    const now = new Date("2026-07-20T12:00:00.000Z");
    const unused = async () => {
      throw new Error("unused");
    };
    const server = createCallCenter({
      acquireAgent: unused,
      applyProviderEvent: unused,
      authorizeAgentCredential: unused,
      clock: () => now,
      handoffConfig: () => ({
        practiceId: "practice-1",
        secret: "handoff-secret",
        sipUri: "sip:acuity-ingress@sip.telnyx.com",
      }),
      listTransferTargets: unused,
      readState: unused,
      releaseAgent: unused,
      reserveHandoff: async (input, options) => {
        captured = { input, options };
        return { handoffId: "handoff-1" };
      },
      setHoldMusic: unused,
      startOutbound: unused,
      transferAgent: unused,
      updateAgentReadiness: unused,
    });

    expect(
      await server.acceptHandoff({
        callerPhone: "+17865550100",
        idempotencyKey: "handoff-key-1",
        routePhoneNumber: "+19542872010",
        sourceCallId: "source-call-1",
      }),
    ).toEqual({ handoffId: "handoff-1" });
    expect(captured).toEqual({
      input: {
        callerPhone: "+17865550100",
        idempotencyKey: "handoff-key-1",
        practiceId: "practice-1",
        routePhoneNumber: "+19542872010",
        sourceCallId: "source-call-1",
      },
      options: {
        baseSipUri: "sip:acuity-ingress@sip.telnyx.com",
        expiresAt: new Date("2026-07-20T12:00:30.000Z"),
        now,
        secret: "handoff-secret",
      },
    });
  });

  it("keeps real-time actor operations behind one interface", () => {
    expect(Object.keys(callCenter).sort()).toEqual([
      "acceptHandoff",
      "applyProviderEvent",
      "authorizeAgentCredential",
      "listTransferTargets",
      "readOperatorState",
      "setHoldMusic",
      "startOutbound",
      "transferAgent",
      "updateAgent",
    ]);
  });
});
