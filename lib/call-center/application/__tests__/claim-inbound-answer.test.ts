import { describe, expect, it } from "bun:test";

import {
  claimInboundAnswer,
  type InboundAnswerClaimContext,
  type InboundAnswerClaimStore,
} from "../claim-inbound-answer";

const now = new Date("2026-07-21T12:00:00.000Z");
const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};

function context(
  update: Partial<InboundAnswerClaimContext> = {},
): InboundAnswerClaimContext {
  return {
    call: {
      deadlineAt: new Date("2026-07-21T12:00:01.000Z"),
      direction: "INBOUND",
      hardDeadlineAt: new Date("2026-07-21T12:01:00.000Z"),
      id: "call-1",
      status: "RINGING",
      voicemailStartedAt: null,
      winningLegId: null,
    },
    leg: {
      agentSessionId: "session-1",
      endpointId: "endpoint-1",
      id: "leg-1",
      kind: "AGENT",
      status: "RINGING",
    },
    endpointOccupied: false,
    priorClaim: null,
    reservation: null,
    session: {
      audioReady: true,
      connectionState: "READY",
      endpointId: "endpoint-1",
      id: "session-1",
      leaseExpiresAt: new Date("2026-07-21T12:01:00.000Z"),
      microphoneReady: true,
      presence: "AVAILABLE",
      userId: "user-1",
    },
    ...update,
  };
}

function store(initial = context()) {
  let current = initial;
  const accepted: unknown[] = [];
  const rejected: unknown[] = [];
  const fake: InboundAnswerClaimStore = {
    withCallLock: async (_actor, _callId, work) =>
      work({
        accept: async (input) => {
          accepted.push(input);
          current = {
            ...current,
            reservation: {
              acceptedAt: input.acceptedAt,
              agentSessionId: input.agentSessionId,
              expiresAt: input.expiresAt,
              id: "reservation-1",
              idempotencyKey: input.idempotencyKey,
              legId: input.legId,
              status: "ACCEPTED",
            },
          };
          return current.reservation!;
        },
        load: async () => current,
        recordRejection: async (input) => {
          rejected.push(input);
          current = {
            ...current,
            priorClaim: {
              legId: input.legId,
              outcome: "REJECTED",
              reason: input.reason,
              sessionId: input.sessionId,
            },
          };
        },
        release: async () => true,
      }),
  };
  return { accepted, fake, rejected };
}

describe("inbound Answer authority", () => {
  it("accepts one exact offered leg and caps its grace at the hard deadline", async () => {
    const state = store();

    await expect(
      claimInboundAnswer(
        state.fake,
        actor,
        {
          callId: "call-1",
          idempotencyKey: "answer-1",
          legId: "leg-1",
          sessionId: "session-1",
        },
        now,
      ),
    ).resolves.toMatchObject({
      replayed: false,
      reservation: {
        expiresAt: new Date("2026-07-21T12:00:05.000Z"),
        id: "reservation-1",
      },
      status: "ACCEPTED",
    });
    expect(state.accepted).toHaveLength(1);
  });

  it("replays the same accepted claim without a second reservation", async () => {
    const existing = {
      acceptedAt: now,
      agentSessionId: "session-1",
      expiresAt: new Date("2026-07-21T12:00:05.000Z"),
      id: "reservation-1",
      idempotencyKey: "answer-1",
      legId: "leg-1",
      status: "ACCEPTED" as const,
    };
    const state = store(context({ reservation: existing }));

    await expect(
      claimInboundAnswer(
        state.fake,
        actor,
        {
          callId: "call-1",
          idempotencyKey: "answer-1",
          legId: "leg-1",
          sessionId: "session-1",
        },
        now,
      ),
    ).resolves.toEqual({ replayed: true, reservation: existing, status: "ACCEPTED" });
    expect(state.accepted).toHaveLength(0);
  });

  it("replays the original accepted result after its reservation expires", async () => {
    const existing = {
      acceptedAt: now,
      agentSessionId: "session-1",
      expiresAt: new Date("2026-07-21T12:00:01.000Z"),
      id: "reservation-1",
      idempotencyKey: "answer-1",
      legId: "leg-1",
      status: "EXPIRED" as const,
    };
    const state = store(
      context({
        priorClaim: {
          actorUserId: actor.userId,
          outcome: "ACCEPTED",
          reservation: existing,
        },
        reservation: existing,
      }),
    );

    await expect(
      claimInboundAnswer(
        state.fake,
        actor,
        {
          callId: "call-1",
          idempotencyKey: "answer-1",
          legId: "leg-1",
          sessionId: "session-1",
        },
        new Date("2026-07-21T12:00:02.000Z"),
      ),
    ).resolves.toEqual({
      replayed: true,
      reservation: existing,
      status: "ACCEPTED",
    });
    expect(state.accepted).toHaveLength(0);
  });

  it("rejects reuse of one key for a different offer identity", async () => {
    const state = store(
      context({
        priorClaim: {
          legId: "old-leg",
          outcome: "REJECTED",
          reason: "STALE_OFFER",
          sessionId: "old-session",
        },
      }),
    );

    await expect(
      claimInboundAnswer(
        state.fake,
        actor,
        {
          callId: "call-1",
          idempotencyKey: "answer-1",
          legId: "leg-1",
          sessionId: "session-1",
        },
        now,
      ),
    ).resolves.toMatchObject({
      reason: "IDEMPOTENCY_KEY_REUSED",
      status: "REJECTED",
    });
  });

  it("rejects a competing claim while the first reservation is valid", async () => {
    const state = store(
      context({
        reservation: {
          acceptedAt: now,
          agentSessionId: "session-2",
          expiresAt: new Date("2026-07-21T12:00:05.000Z"),
          id: "reservation-1",
          idempotencyKey: "answer-other",
          legId: "leg-2",
          status: "ACCEPTED",
        },
      }),
    );

    await expect(
      claimInboundAnswer(
        state.fake,
        actor,
        {
          callId: "call-1",
          idempotencyKey: "answer-1",
          legId: "leg-1",
          sessionId: "session-1",
        },
        now,
      ),
    ).resolves.toEqual({
      callId: "call-1",
      legId: "leg-1",
      reason: "ANSWER_IN_PROGRESS",
      status: "REJECTED",
    });
    expect(state.rejected).toHaveLength(1);
  });

  it("does not replay another actor's accepted reservation", async () => {
    const state = store(
      context({
        reservation: {
          acceptedAt: now,
          agentSessionId: "session-1",
          expiresAt: new Date("2026-07-21T12:00:05.000Z"),
          id: "reservation-1",
          idempotencyKey: "answer-1",
          legId: "leg-1",
          status: "ACCEPTED",
        },
      }),
    );

    await expect(
      claimInboundAnswer(
        state.fake,
        { ...actor, userId: "user-2" },
        {
          callId: "call-1",
          idempotencyKey: "answer-2",
          legId: "leg-1",
          sessionId: "session-1",
        },
        now,
      ),
    ).resolves.toMatchObject({
      reason: "AGENT_SESSION_UNAVAILABLE",
      status: "REJECTED",
    });
  });

  it("does not replay another actor's historic accepted result", async () => {
    const existing = {
      acceptedAt: now,
      agentSessionId: "session-1",
      expiresAt: new Date("2026-07-21T12:00:01.000Z"),
      id: "reservation-1",
      idempotencyKey: "answer-1",
      legId: "leg-1",
      status: "EXPIRED" as const,
    };
    const state = store(
      context({
        priorClaim: {
          actorUserId: "user-1",
          outcome: "ACCEPTED",
          reservation: existing,
        },
        reservation: existing,
      }),
    );

    await expect(
      claimInboundAnswer(
        state.fake,
        { ...actor, userId: "user-2" },
        {
          callId: "call-1",
          idempotencyKey: "answer-1",
          legId: "leg-1",
          sessionId: "session-1",
        },
        new Date("2026-07-21T12:00:02.000Z"),
      ),
    ).resolves.toMatchObject({
      reason: "IDEMPOTENCY_KEY_REUSED",
      status: "REJECTED",
    });
  });

  it("replays a rejected claim even if the underlying call state changes", async () => {
    const state = store(context({ endpointOccupied: true }));
    const input = {
      callId: "call-1",
      idempotencyKey: "answer-1",
      legId: "leg-1",
      sessionId: "session-1",
    };

    const first = await claimInboundAnswer(state.fake, actor, input, now);
    expect(first).toMatchObject({
      reason: "AGENT_SESSION_UNAVAILABLE",
      status: "REJECTED",
    });

    await expect(
      claimInboundAnswer(state.fake, actor, input, new Date(now.getTime() + 1)),
    ).resolves.toEqual(first);
    expect(state.rejected).toHaveLength(1);
  });

  it("rejects claims at or after the normal deadline", async () => {
    for (const claimAt of [now, new Date(now.getTime() + 1)]) {
      const state = store(context({ call: { ...context().call, deadlineAt: now } }));
      await expect(
        claimInboundAnswer(
          state.fake,
          actor,
          {
            callId: "call-1",
            idempotencyKey: `answer-${claimAt.getTime()}`,
            legId: "leg-1",
            sessionId: "session-1",
          },
          claimAt,
        ),
      ).resolves.toMatchObject({ reason: "STALE_OFFER", status: "REJECTED" });
    }
  });
});
