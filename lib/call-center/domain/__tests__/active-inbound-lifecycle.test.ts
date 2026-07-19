import { describe, expect, it } from "bun:test";

import {
  decideActiveInboundLifecycle,
  type ActiveInboundLifecycleInput,
} from "../active-inbound-lifecycle";

const now = new Date("2026-07-12T12:00:00.000Z");

function input(
  overrides: Partial<ActiveInboundLifecycleInput> = {},
): ActiveInboundLifecycleInput {
  return {
    agentLegs: [],
    callId: "call-1",
    customerLegId: "customer-leg-1",
    deadlineAt: null,
    now,
    processedBridgeLegId: null,
    queue: { id: "queue-1", voicemailEnabled: true },
    winningLegId: null,
    ...overrides,
  };
}

describe("inbound lifecycle", () => {
  it("starts voicemail immediately when no agents can be offered", () => {
    expect(decideActiveInboundLifecycle(input())).toMatchObject({
      deadlineAt: new Date("2026-07-12T12:00:20.000Z"),
      disposition: "VOICEMAIL",
      status: "VOICEMAIL",
    });
  });

  it("rings until the fixed deadline", () => {
    expect(
      decideActiveInboundLifecycle(
        input({ agentLegs: [{ id: "agent-1", status: "RINGING" }] }),
      ),
    ).toMatchObject({
      disposition: "WAITING_FOR_AGENT",
      status: "RINGING",
    });
  });

  it("elects only the bridge leg currently being processed", () => {
    const result = decideActiveInboundLifecycle(
      input({
        agentLegs: [
          { id: "other", status: "BRIDGED" },
          { id: "winner", status: "BRIDGED" },
        ],
        processedBridgeLegId: "winner",
      }),
    );

    expect(result.winningLegId).toBe("winner");
    expect(result.intents).toContainEqual(
      expect.objectContaining({ legId: "other", type: "HANGUP_LEG" }),
    );
  });

  it("never replaces a persisted winner", () => {
    expect(
      decideActiveInboundLifecycle(
        input({
          agentLegs: [
            { id: "winner", status: "BRIDGED" },
            { id: "later", status: "BRIDGED" },
          ],
          processedBridgeLegId: "later",
          winningLegId: "winner",
        }),
      ).winningLegId,
    ).toBe("winner");
  });

  it("does not treat answer as connection proof", () => {
    expect(
      decideActiveInboundLifecycle(
        input({
          agentLegs: [{ id: "answered", status: "ANSWERED" }],
          processedBridgeLegId: "answered",
        }),
      ).disposition,
    ).toBe("WAITING_FOR_AGENT");
  });

  it("starts voicemail once the offer window expires", () => {
    const result = decideActiveInboundLifecycle(
      input({
        agentLegs: [{ id: "agent-1", status: "RINGING" }],
        deadlineAt: now,
      }),
    );

    expect(result.disposition).toBe("VOICEMAIL");
    expect(result.intents.map(({ type }) => type)).toEqual([
      "STOP_PLAYBACK",
      "HANGUP_LEG",
      "START_VOICEMAIL",
      "CREATE_TASK",
    ]);
  });

  it("starts voicemail when the final offered leg fails", () => {
    expect(
      decideActiveInboundLifecycle(
        input({ agentLegs: [{ id: "agent-1", status: "FAILED" }] }),
      ),
    ).toMatchObject({
      disposition: "VOICEMAIL",
      status: "VOICEMAIL",
    });
  });

  it("abandons when voicemail is disabled", () => {
    const result = decideActiveInboundLifecycle(
      input({
        deadlineAt: now,
        queue: { id: "queue-1", voicemailEnabled: false },
      }),
    );

    expect(result.status).toBe("ABANDONED");
    expect(result.intents.map(({ type }) => type)).toEqual([
      "STOP_PLAYBACK",
      "HANGUP_LEG",
      "CREATE_TASK",
    ]);
  });
});
