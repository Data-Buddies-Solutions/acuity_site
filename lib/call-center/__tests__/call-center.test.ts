import { describe, expect, it } from "bun:test";

import {
  callCenter,
  createCallCenter,
  startCanonicalOutbound,
  startCanonicalTransfer,
} from "../call-center";

const envelope = {
  body: { data: { event_type: "call.bridged", id: "event-1", payload: {} } },
  eventType: "call.bridged",
  occurredAt: new Date("2026-07-18T12:00:00.000Z"),
  providerEventId: "event-1",
};

const actor = {
  allowedLocationIds: [],
  hasAllLocationAccess: true,
  practiceId: "practice-1",
  userId: "user-1",
};

const outboundInput = {
  clientInstanceId: "browser-1",
  destination: "+15555550123",
  idempotencyKey: "operation-1",
  numberId: "number-1",
  queueId: "queue-1",
};

describe("server Call Center module", () => {
  it("settles inbound offers before creating an outbound call", async () => {
    const calls: string[] = [];
    const result = await startCanonicalOutbound(
      {
        create: async () => {
          calls.push("create");
          return { callId: "outbound-1", commandId: "dial-customer-1" };
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
      actor,
      outboundInput,
    );

    expect(calls).toEqual([
      "prepare",
      "dispatch:hangup-1",
      "create",
      "dispatch:dial-customer-1",
    ]);
    expect(result).toEqual({
      callId: "outbound-1",
      commandId: "dial-customer-1",
    });
  });

  it("reports outbound initiation timing by phase without caller data", async () => {
    let elapsed = 0;
    const timings: Record<string, unknown>[] = [];

    await startCanonicalOutbound(
      {
        create: async () => {
          elapsed += 5;
          return { commandId: "dial-customer-1" };
        },
        dispatch: async (commandId) => {
          elapsed += commandId === "hangup-1" ? 3 : 7;
          return { commandId, markSent: "MARKED", status: "DISPATCHED" };
        },
        monotonicNow: () => elapsed,
        prepare: async () => {
          elapsed += 2;
          return ["hangup-1"];
        },
        reportTiming: (timing) => timings.push(timing),
      },
      actor,
      outboundInput,
    );

    expect(timings).toEqual([
      { durationMs: 2, phase: "prepare", resultClass: "success" },
      { durationMs: 3, phase: "cleanup-dispatch", resultClass: "success" },
      { durationMs: 5, phase: "create", resultClass: "success" },
      { durationMs: 7, phase: "provider-dispatch", resultClass: "success" },
      { durationMs: 17, phase: "total", resultClass: "success" },
    ]);
    expect(JSON.stringify(timings)).not.toContain(outboundInput.destination);
  });

  it("does not create outbound intent while offer cleanup is unresolved", async () => {
    let created = false;
    const timings: Record<string, unknown>[] = [];
    await expect(
      startCanonicalOutbound(
        {
          create: async () => {
            created = true;
            return { commandId: "dial-customer-1" };
          },
          dispatch: async (commandId) => ({
            commandId,
            errorCode: "SENDING_OUTCOME_AMBIGUOUS",
            status: "DEFERRED",
          }),
          monotonicNow: () => 0,
          prepare: async () => ["hangup-1"],
          reportTiming: (timing) => timings.push(timing),
        },
        actor,
        outboundInput,
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(created).toBe(false);
    expect(timings).toEqual([
      { durationMs: 0, phase: "prepare", resultClass: "success" },
      { durationMs: 0, phase: "cleanup-dispatch", resultClass: "error" },
      { durationMs: 0, phase: "total", resultClass: "error" },
    ]);
  });

  it("distinguishes a definitive customer dial rejection from an ambiguous result", async () => {
    const dependencies = {
      create: async () => ({ commandId: "dial-customer-1" }),
      prepare: async () => [],
    };

    await expect(
      startCanonicalOutbound(
        {
          ...dependencies,
          dispatch: async (commandId: string) => ({
            commandId,
            errorCode: "PROVIDER_VALIDATION_FAILED",
            followUpCommandIds: [],
            status: "FAILED" as const,
          }),
        },
        actor,
        outboundInput,
      ),
    ).rejects.toMatchObject({ retryable: false, status: 502 });

    await expect(
      startCanonicalOutbound(
        {
          ...dependencies,
          dispatch: async (commandId: string) => ({
            commandId,
            errorCode: "SENDING_OUTCOME_AMBIGUOUS" as const,
            status: "DEFERRED" as const,
          }),
        },
        actor,
        outboundInput,
      ),
    ).rejects.toMatchObject({ retryable: true, status: 503 });
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
        actor,
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

  it("applies a durable provider event before returning to the webhook", async () => {
    const calls: string[] = [];
    const unused = async () => {
      throw new Error("unused");
    };
    const server = createCallCenter({
      acquireAgent: unused,
      applyProviderEvent: async (receivedEnvelope) => {
        calls.push(`apply:${receivedEnvelope.providerEventId}`);
        return {
          duplicate: false,
          outcome: "PROCESSED" as const,
          projection: { callId: "call-1", commandIds: [] },
        };
      },
      authorizeAgentCredential: unused,
      claimInboundAnswer: unused,
      clock: () => new Date("2026-07-18T12:00:00.000Z"),
      handoffConfig: () => ({
        practiceId: "practice-1",
        secret: "handoff-secret",
        sipUri: "sip:acuity-ingress@sip.telnyx.com",
      }),
      listTransferTargets: unused,
      readState: unused,
      releaseAgent: unused,
      releaseInboundAnswer: unused,
      reserveHandoff: unused,
      setHoldMusic: unused,
      startOutbound: unused,
      transferAgent: unused,
      updateAgentReadiness: unused,
    });

    const result = await server.applyProviderEvent(envelope);

    expect(calls).toEqual(["apply:event-1"]);
    expect(result).toMatchObject({
      duplicate: false,
      outcome: "PROCESSED",
      projection: { callId: "call-1" },
    });
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
      claimInboundAnswer: unused,
      clock: () => now,
      handoffConfig: () => ({
        practiceId: "practice-1",
        secret: "handoff-secret",
        sipUri: "sip:acuity-ingress@sip.telnyx.com",
      }),
      listTransferTargets: unused,
      readState: unused,
      releaseAgent: unused,
      releaseInboundAnswer: unused,
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
      "claimInboundAnswer",
      "listTransferTargets",
      "readOperatorState",
      "releaseInboundAnswer",
      "setHoldMusic",
      "startOutbound",
      "transferAgent",
      "updateAgent",
    ]);
  });
});
