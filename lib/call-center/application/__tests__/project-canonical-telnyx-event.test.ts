import { describe, expect, test } from "bun:test";

import {
  canonicalProjectionErrorCode,
  createCanonicalTelnyxEventProcessor,
} from "../project-canonical-telnyx-event";
import { CanonicalProjectionError } from "../../infrastructure/prisma-canonical-call-projector";

describe("canonicalProjectionErrorCode", () => {
  test("preserves canonical domain errors", () => {
    expect(
      canonicalProjectionErrorCode(
        new CanonicalProjectionError("CANONICAL_QUEUE_NOT_CONFIGURED"),
      ),
    ).toBe("CANONICAL_QUEUE_NOT_CONFIGURED");
  });

  test("preserves safe Prisma codes without logging exception details", () => {
    expect(canonicalProjectionErrorCode({ code: "P2022" })).toBe(
      "CANONICAL_PRISMA_P2022",
    );
  });

  test("keeps unexpected errors generic", () => {
    expect(canonicalProjectionErrorCode(new Error("sensitive detail"))).toBe(
      "CANONICAL_PROJECTION_FAILED",
    );
  });

  test("does not acknowledge an exhausted canonical event", async () => {
    const process = createCanonicalTelnyxEventProcessor({
      inbox: {
        claim: async () => "EXHAUSTED",
        completeIgnored: async () => true,
        fail: async () => true,
      },
      projector: {} as never,
    });

    await expect(process("event-1")).resolves.toEqual({
      errorCode: "CANONICAL_RETRIES_EXHAUSTED",
      outcome: "FAILED",
    });
  });

  test("immediately dispatches both agent dials woken by the customer answer", async () => {
    const dispatched: string[] = [];
    const receivedAt = new Date("2026-07-19T12:00:00.000Z");
    const event = {
      canonicalProjectionAttemptCount: 1,
      canonicalProjectionErrorCode: null,
      canonicalProjectionStatus: "PROCESSING" as const,
      effectOwner: "CANONICAL" as const,
      eventType: "call.answered",
      id: "event-1",
      payload: {
        data: {
          event_type: "call.answered",
          id: "provider-event-1",
          payload: {
            call_control_id: "customer-control-1",
            call_leg_id: "customer-leg-provider-1",
            call_session_id: "customer-session-1",
            direction: "incoming",
            from: "+17865550100",
            to: "+17865550101",
          },
        },
      },
      providerCallSessionId: "customer-session-1",
      providerEventId: "provider-event-1",
      receivedAt,
      updatedAt: receivedAt,
    };
    const process = createCanonicalTelnyxEventProcessor({
      dispatchCommand: async (commandId) => {
        dispatched.push(commandId);
        return {
          commandId,
          markSent: "MARKED",
          status: "DISPATCHED",
        };
      },
      inbox: {
        claim: async () => event,
        completeIgnored: async () => true,
        fail: async () => true,
      },
      projector: {
        projectAndComplete: async (_event, fact) => {
          expect(fact.eventType).toBe("call.answered");
          return {
            callId: "call-1",
            callStatus: "RINGING",
            commandIds: ["dial-agent-a", "dial-agent-b"],
            effectOwner: "CANONICAL",
            legId: "customer-leg-1",
            legStatus: "ANSWERED",
            practiceId: "practice-1",
          };
        },
      },
    });

    await expect(process(event.id)).resolves.toMatchObject({ outcome: "PROCESSED" });
    expect(dispatched).toEqual(["dial-agent-a", "dial-agent-b"]);
  });
});
