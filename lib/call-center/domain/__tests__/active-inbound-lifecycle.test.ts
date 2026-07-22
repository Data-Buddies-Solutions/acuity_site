import { describe, expect, it } from "bun:test";

import {
  decideActiveInboundLifecycle,
  projectInboundOfferTiming,
  type ActiveInboundLifecycleInput,
} from "../active-inbound-lifecycle";

const now = new Date("2026-07-12T12:00:00.000Z");

function input(
  overrides: Partial<ActiveInboundLifecycleInput> = {},
): ActiveInboundLifecycleInput {
  return {
    agentLegs: [],
    answerReservation: null,
    callId: "call-1",
    customerLegId: "customer-leg-1",
    deadlineAt: null,
    hardDeadlineAt: new Date("2026-07-12T12:01:00.000Z"),
    now,
    processedBridgeLegId: null,
    queue: { id: "queue-1", voicemailEnabled: true },
    winningLegId: null,
    ...overrides,
  };
}

describe("inbound lifecycle", () => {
  it("starts the shared offer window from first agent provider progress", () => {
    expect(
      projectInboundOfferTiming({
        deadlineAt: null,
        direction: "INBOUND",
        eventType: "call.initiated",
        firstAgentInitiatedAt: null,
        hardDeadlineAt: new Date("2026-07-12T12:01:00.000Z"),
        legKind: "AGENT",
        occurredAt: now,
      }),
    ).toEqual({
      deadlineAt: new Date("2026-07-12T12:00:20.000Z"),
      firstAgentInitiatedAt: now,
    });
  });

  it("never extends an established offer deadline for later endpoints", () => {
    const first = new Date("2026-07-12T11:59:55.000Z");
    const deadline = new Date("2026-07-12T12:00:15.000Z");
    expect(
      projectInboundOfferTiming({
        deadlineAt: deadline,
        direction: "INBOUND",
        eventType: "call.ringing",
        firstAgentInitiatedAt: first,
        hardDeadlineAt: new Date("2026-07-12T12:01:00.000Z"),
        legKind: "AGENT",
        occurredAt: now,
      }),
    ).toEqual({ deadlineAt: deadline, firstAgentInitiatedAt: first });
  });

  it("moves the deadline earlier when an earlier provider fact arrives late", () => {
    const later = new Date("2026-07-12T12:00:05.000Z");
    expect(
      projectInboundOfferTiming({
        deadlineAt: new Date("2026-07-12T12:00:25.000Z"),
        direction: "INBOUND",
        eventType: "call.ringing",
        firstAgentInitiatedAt: later,
        hardDeadlineAt: new Date("2026-07-12T12:01:00.000Z"),
        legKind: "AGENT",
        occurredAt: now,
      }),
    ).toEqual({
      deadlineAt: new Date("2026-07-12T12:00:20.000Z"),
      firstAgentInitiatedAt: now,
    });
  });

  it("starts voicemail immediately when no agents can be offered", () => {
    expect(decideActiveInboundLifecycle(input())).toMatchObject({
      deadlineAt: null,
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

  it("waits for first provider progress without inventing a normal deadline", () => {
    expect(
      decideActiveInboundLifecycle(
        input({ agentLegs: [{ id: "agent-1", status: "CREATED" }] }),
      ),
    ).toMatchObject({
      deadlineAt: null,
      disposition: "WAITING_FOR_AGENT",
    });
  });

  it("enforces the hard cap when provider progress never starts", () => {
    expect(
      decideActiveInboundLifecycle(
        input({
          agentLegs: [{ id: "agent-1", status: "CREATED" }],
          hardDeadlineAt: now,
        }),
      ).disposition,
    ).toBe("VOICEMAIL");
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

  it("protects an accepted answer reservation across the offer deadline", () => {
    expect(
      decideActiveInboundLifecycle(
        input({
          agentLegs: [{ answeredAt: null, id: "agent-1", status: "RINGING" }],
          answerReservation: {
            expiresAt: new Date("2026-07-12T12:00:05.000Z"),
            legId: "agent-1",
            status: "ACCEPTED",
          },
          deadlineAt: now,
        }),
      ),
    ).toMatchObject({
      disposition: "WAITING_FOR_AGENT",
      protectedLegId: "agent-1",
      status: "RINGING",
    });
  });

  it("accepts provider bridge after the offer deadline within the 5-second grace", () => {
    const offerStartedAt = new Date("2026-07-12T11:59:40.000Z");
    const acceptedAt = new Date(offerStartedAt.getTime() + 19_900);
    const result = decideActiveInboundLifecycle(
      input({
        agentLegs: [
          {
            answeredAt: acceptedAt,
            id: "agent-1",
            status: "BRIDGED",
          },
        ],
        answerReservation: {
          expiresAt: new Date(acceptedAt.getTime() + 5_000),
          legId: "agent-1",
          status: "ANSWERED",
        },
        deadlineAt: new Date(offerStartedAt.getTime() + 20_000),
        now: new Date(offerStartedAt.getTime() + 21_000),
        processedBridgeLegId: "agent-1",
      }),
    );

    expect(result).toMatchObject({
      disposition: "CONNECTED",
      winningLegId: "agent-1",
    });
    expect(result.intents.map(({ type }) => type)).not.toContain("START_VOICEMAIL");
  });

  it("protects provider answer for the bounded answer-to-bridge grace", () => {
    expect(
      decideActiveInboundLifecycle(
        input({
          agentLegs: [
            {
              answeredAt: new Date("2026-07-12T11:59:58.000Z"),
              id: "agent-1",
              status: "ANSWERED",
            },
          ],
          deadlineAt: now,
        }),
      ),
    ).toMatchObject({
      disposition: "WAITING_FOR_AGENT",
      protectedLegId: "agent-1",
    });
  });

  it("lets the hard queue deadline end an expired answer negotiation", () => {
    expect(
      decideActiveInboundLifecycle(
        input({
          agentLegs: [
            {
              answeredAt: new Date("2026-07-12T11:59:58.000Z"),
              id: "agent-1",
              status: "ANSWERED",
            },
          ],
          answerReservation: {
            expiresAt: new Date("2026-07-12T12:00:05.000Z"),
            legId: "agent-1",
            status: "ANSWERED",
          },
          deadlineAt: now,
          hardDeadlineAt: now,
        }),
      ).disposition,
    ).toBe("VOICEMAIL");
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
