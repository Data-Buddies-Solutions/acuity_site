import { describe, expect, it } from "bun:test";

import { createCallCenter } from "../call-center";

const envelope = {
  body: { data: { event_type: "call.bridged", id: "event-1", payload: {} } },
  eventType: "call.bridged",
  occurredAt: new Date("2026-07-18T12:00:00.000Z"),
  providerEventId: "event-1",
};

describe("server Call Center module", () => {
  it("applies a durable provider event before returning to the webhook", async () => {
    const calls: string[] = [];
    const callCenter = createCallCenter({
      acquireAgent: async () => {
        throw new Error("unused");
      },
      applyEvent: async (eventId) => {
        calls.push(`apply:${eventId}`);
        return {
          outcome: "PROCESSED" as const,
          projection: { callId: "call-1", commandIds: [] },
        };
      },
      readState: async () => {
        throw new Error("unused");
      },
      receiveEvent: async () => {
        calls.push("receive");
        return {
          duplicate: false,
          providerWebhookEventId: "stored-event-1",
          processingStatus: "IGNORED",
        };
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

    expect(calls).toEqual(["receive", "apply:stored-event-1"]);
    expect(result).toMatchObject({
      duplicate: false,
      projection: {
        outcome: "PROCESSED",
        projection: { callId: "call-1" },
      },
    });
  });

  it("keeps the five external actor operations behind one interface", () => {
    const callCenter = createCallCenter({
      acquireAgent: async () => ({ session: { id: "session-1" } }),
      applyEvent: async () => ({ outcome: "SKIPPED" as const }),
      readState: async () => ({ revision: "1" }),
      receiveEvent: async () => ({
        duplicate: true,
        providerWebhookEventId: "event-1",
        processingStatus: "IGNORED",
      }),
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
