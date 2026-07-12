import { describe, expect, it } from "bun:test";

import {
  decideActiveInboundCallback,
  decideActiveInboundDeadline,
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
    eligibleAgentCount: 1,
    now,
    processedBridgeLegId: null,
    queue: {
      id: "queue-1",
      maxWaitSec: 60,
      overflowQueueId: null,
      ringTimeoutSec: 20,
      voicemailEnabled: true,
    },
    queueDeadlineAt: null,
    visitedQueueIds: ["queue-1"],
    winningLegId: null,
    ...overrides,
  };
}

describe("ACTIVE inbound lifecycle decision", () => {
  it("keeps the persisted first-processed bridge winner", () => {
    const result = decideActiveInboundLifecycle(
      input({
        agentLegs: [
          { id: "winner", status: "BRIDGED" },
          { id: "later-callback", status: "BRIDGED" },
        ],
        processedBridgeLegId: "later-callback",
        winningLegId: "winner",
      }),
    );

    expect(result.winningLegId).toBe("winner");
    expect(result.intents).toEqual([
      {
        description: "Stop caller ringback",
        idempotencyKey: "active:call-1:stop-ringback",
        legId: "customer-leg-1",
        type: "STOP_PLAYBACK",
      },
      {
        description: "Hang up non-winning live agent leg",
        idempotencyKey: "active:call-1:winner:winner:hangup:later-callback",
        legId: "later-callback",
        type: "HANGUP_LEG",
      },
    ]);
  });

  it("keeps an authorized transfer target live until it bridges or times out", () => {
    const result = decideActiveInboundLifecycle(
      input({
        agentLegs: [
          { id: "source", status: "BRIDGED" },
          { id: "target", replacesLegId: "source", status: "RINGING" },
        ],
        deadlineAt: new Date("2026-07-12T12:00:20.001Z"),
        winningLegId: "source",
      }),
    );

    expect(result.pendingReplacementLegIds).toEqual(["target"]);
    expect(
      result.intents.some((intent) => "legId" in intent && intent.legId === "target"),
    ).toBe(false);
  });

  it("hangs up a timed-out transfer target while preserving the source winner", () => {
    const result = decideActiveInboundLifecycle(
      input({
        agentLegs: [
          { id: "source", status: "BRIDGED" },
          { id: "target", replacesLegId: "source", status: "RINGING" },
        ],
        deadlineAt: now,
        winningLegId: "source",
      }),
    );

    expect(result.winningLegId).toBe("source");
    expect(result.pendingReplacementLegIds).toEqual([]);
    expect(result.intents).toContainEqual(
      expect.objectContaining({ legId: "target", type: "HANGUP_LEG" }),
    );
  });

  it("elects only the bridge leg currently being processed", () => {
    const result = decideActiveInboundLifecycle(
      input({
        agentLegs: [
          { id: "first-in-array", status: "BRIDGED" },
          { id: "processed-first", status: "BRIDGED" },
        ],
        processedBridgeLegId: "processed-first",
      }),
    );

    expect(result.winningLegId).toBe("processed-first");
    expect(result.status).toBe("CONNECTED");
    expect(result.intents.filter((intent) => intent.type === "HANGUP_LEG")).toEqual([
      expect.objectContaining({ legId: "first-in-array" }),
    ]);
  });

  it("does not elect a leg without processed bridge evidence", () => {
    const result = decideActiveInboundLifecycle(
      input({
        agentLegs: [{ id: "answered", status: "ANSWERED" }],
        processedBridgeLegId: "answered",
      }),
    );

    expect(result.disposition).toBe("WAITING_FOR_AGENT");
    expect(result.winningLegId).toBeNull();
  });

  it("caps the current ring deadline at the overall queue deadline", () => {
    const queueDeadlineAt = new Date("2026-07-12T12:00:12.000Z");
    const result = decideActiveInboundLifecycle(input({ queueDeadlineAt }));

    expect(result.queueDeadlineAt).toEqual(queueDeadlineAt);
    expect(result.deadlineAt).toEqual(queueDeadlineAt);
  });

  it("initializes both deadlines from the queue policy", () => {
    const result = decideActiveInboundLifecycle(input());

    expect(result.queueDeadlineAt).toEqual(new Date("2026-07-12T12:01:00.000Z"));
    expect(result.deadlineAt).toEqual(new Date("2026-07-12T12:00:20.000Z"));
  });

  it("falls back when the persisted ring deadline expires", () => {
    const result = decideActiveInboundLifecycle(
      input({
        agentLegs: [{ id: "ringing", status: "RINGING" }],
        deadlineAt: now,
      }),
    );

    expect(result.disposition).toBe("VOICEMAIL");
    expect(result.intents.map((intent) => intent.type)).toEqual([
      "STOP_PLAYBACK",
      "HANGUP_LEG",
      "START_VOICEMAIL",
    ]);
  });

  it("uses an acyclic overflow before voicemail", () => {
    const result = decideActiveInboundLifecycle(
      input({
        eligibleAgentCount: 0,
        queue: {
          id: "queue-1",
          maxWaitSec: 60,
          overflowQueueId: "queue-2",
          ringTimeoutSec: 20,
          voicemailEnabled: true,
        },
      }),
    );

    expect(result.disposition).toBe("OVERFLOW");
    expect(result.intents).toEqual([
      {
        description: "Route call to configured overflow queue",
        fromQueueId: "queue-1",
        idempotencyKey: "active:call-1:overflow:queue-1:queue-2",
        queueId: "queue-2",
        type: "ROUTE_OVERFLOW_QUEUE",
      },
    ]);
  });

  it("falls back to voicemail when overflow would cycle", () => {
    const result = decideActiveInboundLifecycle(
      input({
        eligibleAgentCount: 0,
        queue: {
          id: "queue-2",
          maxWaitSec: 60,
          overflowQueueId: "queue-1",
          ringTimeoutSec: 20,
          voicemailEnabled: true,
        },
        visitedQueueIds: ["queue-1", "queue-2"],
      }),
    );

    expect(result.disposition).toBe("VOICEMAIL");
    expect(result.intents.map((intent) => intent.type)).toEqual([
      "STOP_PLAYBACK",
      "START_VOICEMAIL",
    ]);
  });

  it("does not overflow past the overall queue deadline", () => {
    const result = decideActiveInboundLifecycle(
      input({
        eligibleAgentCount: 0,
        queue: {
          id: "queue-1",
          maxWaitSec: 60,
          overflowQueueId: "queue-2",
          ringTimeoutSec: 20,
          voicemailEnabled: true,
        },
        queueDeadlineAt: now,
      }),
    );

    expect(result.disposition).toBe("VOICEMAIL");
  });

  it("abandons and creates one stable missed-call task when voicemail is disabled", () => {
    const result = decideActiveInboundLifecycle(
      input({
        eligibleAgentCount: 0,
        queue: {
          id: "queue-1",
          maxWaitSec: 60,
          overflowQueueId: null,
          ringTimeoutSec: 20,
          voicemailEnabled: false,
        },
      }),
    );

    expect(result.status).toBe("ABANDONED");
    expect(result.intents.at(-1)).toEqual({
      description: "Create missed-call task",
      idempotencyKey: "active:call-1:task:missed-call",
      kind: "MISSED_CALL",
      type: "CREATE_TASK",
    });
  });

  it("does not fall back while an eligible or live agent leg remains", () => {
    const eligible = decideActiveInboundLifecycle(input({ agentLegs: [] }));
    const live = decideActiveInboundLifecycle(
      input({
        agentLegs: [{ id: "ringing", status: "RINGING" }],
        eligibleAgentCount: 0,
      }),
    );

    expect(eligible.disposition).toBe("WAITING_FOR_AGENT");
    expect(eligible.status).toBe("QUEUED");
    expect(live.disposition).toBe("WAITING_FOR_AGENT");
    expect(live.status).toBe("RINGING");
  });

  it("uses the same pure decision for callback and deadline paths", () => {
    const snapshot = input({
      agentLegs: [],
      eligibleAgentCount: 0,
      queue: {
        id: "queue-1",
        maxWaitSec: 60,
        overflowQueueId: null,
        ringTimeoutSec: 20,
        voicemailEnabled: true,
      },
    });

    expect(decideActiveInboundCallback(snapshot)).toEqual(
      decideActiveInboundDeadline(snapshot),
    );
  });
});
