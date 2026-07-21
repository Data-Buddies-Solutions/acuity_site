import { describe, expect, it } from "bun:test";

import type { Prisma } from "@/generated/prisma/client";

import { projectActiveInboundAnswerReservation } from "../prisma-active-inbound-lifecycle-store";

const answeredAt = new Date("2026-07-21T12:00:03.000Z");

function transaction({
  callStatus = "RINGING",
  legErrorCode = null as string | null,
  reservationExists = true,
} = {}) {
  const events: Array<Record<string, unknown>> = [];
  const reservation = {
    acceptedAt: new Date("2026-07-21T12:00:00.000Z"),
    agentSessionId: "session-1",
    answeredAt: null as Date | null,
    bridgedAt: null as Date | null,
    callId: "call-1",
    expiresAt: new Date("2026-07-21T12:00:05.000Z"),
    failureCode: null as string | null,
    id: "reservation-1",
    idempotencyKey: "answer-1",
    legId: "leg-1",
    releasedAt: null as Date | null,
    status: "ACCEPTED" as
      "ACCEPTED" | "ANSWERED" | "BRIDGED" | "EXPIRED" | "FAILED" | "RELEASED",
  };
  const tx = {
    callCenterAnswerReservation: {
      findUnique: async () => (reservationExists ? reservation : null),
      updateMany: async ({ data }: { data: Partial<typeof reservation> }) => {
        Object.assign(reservation, data);
        return { count: 1 };
      },
    },
    callCenterCall: {
      findUnique: async () => ({
        legs: [{ errorCode: legErrorCode }],
        status: callStatus,
      }),
    },
    callCenterEvent: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        events.push(create);
        return { revision: BigInt(1) };
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { events, reservation, tx };
}

describe("provider Answer reservation projection", () => {
  it("advances provider answer without reporting a connected winner", async () => {
    const fake = transaction();

    await projectActiveInboundAnswerReservation(fake.tx, {
      callId: "call-1",
      eventType: "call.answered",
      hardDeadlineAt: new Date("2026-07-21T12:01:00.000Z"),
      legId: "leg-1",
      occurredAt: answeredAt,
      practiceId: "practice-1",
      providerEventId: "provider-answer-1",
    });

    expect(fake.reservation).toMatchObject({
      answeredAt,
      expiresAt: new Date("2026-07-21T12:00:08.000Z"),
      status: "ANSWERED",
    });
    expect(fake.events).toEqual([
      expect.objectContaining({
        aggregateId: "call-1",
        type: "CALL_ANSWER_PROVIDER_ANSWERED",
      }),
    ]);
  });

  it("finalizes the matching reservation on provider bridge", async () => {
    const fake = transaction();
    const bridgedAt = new Date("2026-07-21T12:00:04.000Z");

    await projectActiveInboundAnswerReservation(fake.tx, {
      callId: "call-1",
      eventType: "call.bridged",
      hardDeadlineAt: new Date("2026-07-21T12:01:00.000Z"),
      legId: "leg-1",
      occurredAt: bridgedAt,
      practiceId: "practice-1",
      providerEventId: "provider-bridge-1",
    });

    expect(fake.reservation).toMatchObject({ bridgedAt, status: "BRIDGED" });
    expect(fake.events[0]).toMatchObject({ type: "CALL_ANSWER_PROVIDER_BRIDGED" });
  });

  it("reports late provider connection evidence after offer timeout", async () => {
    const fake = transaction({
      callStatus: "VOICEMAIL",
      legErrorCode: "OFFER_TIMEOUT",
      reservationExists: false,
    });
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...input: unknown[]) => errors.push(input);

    try {
      await projectActiveInboundAnswerReservation(fake.tx, {
        callId: "call-1",
        eventType: "call.answered",
        hardDeadlineAt: new Date("2026-07-21T12:01:00.000Z"),
        legId: "leg-1",
        occurredAt: answeredAt,
        practiceId: "practice-1",
        providerEventId: "provider-late-answer-1",
      });
    } finally {
      console.error = originalError;
    }

    expect(errors).toEqual([
      [
        expect.stringContaining("settled despite provider connection evidence"),
        expect.objectContaining({
          callId: "call-1",
          errorCode: "INBOUND_CONNECTION_EVIDENCE_CONFLICT",
          legId: "leg-1",
        }),
      ],
    ]);
  });

  it("releases a bridged reservation when the connected leg hangs up", async () => {
    const fake = transaction();
    fake.reservation.status = "BRIDGED";
    const hungUpAt = new Date("2026-07-21T12:00:05.000Z");

    await projectActiveInboundAnswerReservation(fake.tx, {
      callId: "call-1",
      eventType: "call.hangup",
      hardDeadlineAt: new Date("2026-07-21T12:01:00.000Z"),
      legId: "leg-1",
      occurredAt: hungUpAt,
      practiceId: "practice-1",
      providerEventId: "provider-hangup-1",
    });

    expect(fake.reservation).toMatchObject({
      releasedAt: hungUpAt,
      status: "RELEASED",
    });
    expect(fake.events[0]).toMatchObject({ type: "CALL_ANSWER_RELEASED" });
  });
});
