import { describe, expect, it } from "bun:test";

import { createCallCenter, startCanonicalOutbound } from "../call-center";

const envelope = {
  body: { data: { event_type: "call.bridged", id: "event-1", payload: {} } },
  eventType: "call.bridged",
  occurredAt: new Date("2026-07-18T12:00:00.000Z"),
  providerEventId: "event-1",
};

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

  it("applies a durable provider event before returning to the webhook", async () => {
    const calls: string[] = [];
    const callCenter = createCallCenter({
      acquireAgent: async () => {
        throw new Error("unused");
      },
      applyProviderEvent: async (receivedEnvelope) => {
        calls.push(`apply:${receivedEnvelope.providerEventId}`);
        return {
          duplicate: false,
          outcome: "PROCESSED" as const,
          projection: { callId: "call-1", commandIds: [] },
        };
      },
      readState: async () => {
        throw new Error("unused");
      },
      releaseAgent: async () => {
        throw new Error("unused");
      },
      reserveHandoff: async () => {
        throw new Error("unused");
      },
      startOutbound: async () => {
        throw new Error("unused");
      },
      updateAgentReadiness: async () => {
        throw new Error("unused");
      },
    });

    const result = await callCenter.applyProviderEvent(envelope);

    expect(calls).toEqual(["apply:event-1"]);
    expect(result).toMatchObject({
      duplicate: false,
      outcome: "PROCESSED",
      projection: { callId: "call-1" },
    });
  });

  it("keeps the five external actor operations behind one interface", () => {
    const callCenter = createCallCenter({
      acquireAgent: async () => ({ session: { id: "session-1" } }),
      applyProviderEvent: async () => ({ outcome: "IGNORED" as const }),
      readState: async () => ({ revision: "1" }),
      releaseAgent: async () => ({ session: { id: "session-1" } }),
      reserveHandoff: async () => ({ handoffId: "handoff-1" }),
      startOutbound: async () => ({ callId: "call-1" }),
      updateAgentReadiness: async () => ({ session: { id: "session-1" } }),
    });

    expect(Object.keys(callCenter).sort()).toEqual([
      "acceptHandoff",
      "applyProviderEvent",
      "readOperatorState",
      "startOutbound",
      "updateAgent",
    ]);
  });
});
