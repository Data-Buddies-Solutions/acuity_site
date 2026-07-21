import { describe, expect, it } from "bun:test";

import { createInboundAnswerHandler, createInboundAnswerReleaseHandler } from "./handler";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const context = { params: Promise.resolve({ callId: "call-1" }) };

describe("canonical inbound Answer route", () => {
  it("passes only authenticated Answer identity to the lifecycle module", async () => {
    let captured: unknown;
    const POST = createInboundAnswerHandler({
      claim: async (claimActor, input) => {
        captured = { actor: claimActor, input };
        return {
          replayed: false,
          reservation: {
            acceptedAt: new Date("2026-07-21T12:00:00.000Z"),
            agentSessionId: input.sessionId,
            expiresAt: new Date("2026-07-21T12:00:05.000Z"),
            id: "reservation-1",
            idempotencyKey: input.idempotencyKey,
            legId: input.legId,
            status: "ACCEPTED" as const,
          },
          status: "ACCEPTED" as const,
        };
      },
      getActor: async () => actor,
    });

    const response = await POST(
      new Request("https://example.test", {
        body: JSON.stringify({ legId: "leg-1", sessionId: "session-1" }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": " answer-1 ",
        },
        method: "POST",
      }),
      context,
    );

    expect(response.status).toBe(202);
    expect(captured).toEqual({
      actor,
      input: {
        callId: "call-1",
        idempotencyKey: "answer-1",
        legId: "leg-1",
        sessionId: "session-1",
      },
    });
    expect(await response.json()).toMatchObject({
      reservation: {
        expiresAt: "2026-07-21T12:00:05.000Z",
        id: "reservation-1",
      },
      status: "ACCEPTED",
    });
  });

  it("returns a stable rejection without invoking provider media", async () => {
    const POST = createInboundAnswerHandler({
      claim: async (_actor, input) => ({
        callId: input.callId,
        legId: input.legId,
        reason: "ANSWER_IN_PROGRESS" as const,
        status: "REJECTED" as const,
      }),
      getActor: async () => actor,
    });

    const response = await POST(
      new Request("https://example.test", {
        body: JSON.stringify({ legId: "leg-1", sessionId: "session-1" }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "answer-1",
        },
        method: "POST",
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      callId: "call-1",
      legId: "leg-1",
      reason: "ANSWER_IN_PROGRESS",
      status: "REJECTED",
    });
  });

  it("rejects client-supplied ownership fields", async () => {
    const POST = createInboundAnswerHandler({
      claim: async () => {
        throw new Error("must not run");
      },
      getActor: async () => actor,
    });
    const response = await POST(
      new Request("https://example.test", {
        body: JSON.stringify({
          legId: "leg-1",
          practiceId: "other-practice",
          sessionId: "session-1",
        }),
        headers: { "Content-Type": "application/json", "Idempotency-Key": "key" },
        method: "POST",
      }),
      context,
    );
    expect(response.status).toBe(422);
  });

  it("releases only the authenticated exact reservation after browser failure", async () => {
    let captured: unknown;
    const DELETE = createInboundAnswerReleaseHandler({
      getActor: async () => actor,
      release: async (releaseActor, input) => {
        captured = { actor: releaseActor, input };
        return { released: true as const, status: "RELEASED" as const };
      },
    });

    const response = await DELETE(
      new Request("https://example.test", {
        body: JSON.stringify({
          failureCode: "BROWSER_DISCONNECTED",
          legId: "leg-1",
          sessionId: "session-1",
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "answer-1",
        },
        method: "DELETE",
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(captured).toEqual({
      actor,
      input: {
        callId: "call-1",
        failureCode: "BROWSER_DISCONNECTED",
        idempotencyKey: "answer-1",
        legId: "leg-1",
        sessionId: "session-1",
      },
    });
  });
});
