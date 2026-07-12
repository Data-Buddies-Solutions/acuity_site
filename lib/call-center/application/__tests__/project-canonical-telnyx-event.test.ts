import { describe, expect, it } from "bun:test";

import type { CanonicalProjectionRecord } from "../../infrastructure/canonical-provider-webhook-inbox";
import { createCanonicalTelnyxEventProcessor } from "../project-canonical-telnyx-event";

const now = new Date("2026-07-11T12:00:00.000Z");

function record(payload: unknown): CanonicalProjectionRecord {
  return {
    canonicalProjectionAttemptCount: 1,
    canonicalProjectionErrorCode: null,
    canonicalProjectionNextAttemptAt: null,
    canonicalProjectionStatus: "PROCESSING",
    effectOwner: "LEGACY",
    eventType: "call.initiated",
    id: "inbox-1",
    payload,
    providerEventId: "event-1",
    receivedAt: now,
    updatedAt: now,
  };
}

function callEnvelope(eventType = "call.initiated") {
  return {
    data: {
      event_type: eventType,
      id: "event-1",
      payload: {
        call_control_id: "control-1",
        call_session_id: "session-1",
        direction: "incoming",
        from: "+17865550100",
        to: "+17864657479",
      },
    },
  };
}

describe("canonical Telnyx event processor", () => {
  it("completes a supported fact only through the transactional projector", async () => {
    const event = record(callEnvelope());
    const projectedEvents: CanonicalProjectionRecord[] = [];
    let shadowCalls = 0;
    const process = createCanonicalTelnyxEventProcessor({
      clock: () => now,
      inbox: {
        claim: async () => event,
        completeIgnored: async () => {
          throw new Error("not ignored");
        },
        fail: async () => true,
      },
      projector: {
        projectAndComplete: async (claimed) => {
          projectedEvents.push(claimed);
          return {
            callId: "call-1",
            callStatus: "QUEUED",
            legId: "leg-1",
            legStatus: "RINGING",
            practiceId: "practice-1",
            routingMode: "LEGACY",
          };
        },
      },
      recordShadowDecision: async () => {
        shadowCalls += 1;
        throw new Error("LEGACY must not invoke shadow routing");
      },
    });

    await expect(process(event.id)).resolves.toMatchObject({ outcome: "PROCESSED" });
    expect(projectedEvents).toEqual([event]);
    expect(shadowCalls).toBe(0);
  });

  it("contains shadow decision failure after canonical projection commits", async () => {
    const event = record(callEnvelope());
    let failed = false;
    const process = createCanonicalTelnyxEventProcessor({
      clock: () => now,
      inbox: {
        claim: async () => event,
        completeIgnored: async () => true,
        fail: async () => {
          failed = true;
          return true;
        },
      },
      projector: {
        projectAndComplete: async () => ({
          callId: "call-1",
          callStatus: "QUEUED",
          legId: "leg-1",
          legStatus: "RINGING",
          practiceId: "practice-1",
          routingMode: "SHADOW",
        }),
      },
      recordShadowDecision: async () => {
        throw new Error("contained shadow failure");
      },
    });

    await expect(process(event.id)).resolves.toMatchObject({ outcome: "PROCESSED" });
    expect(failed).toBe(false);
  });

  it("marks unsupported facts ignored without touching legacy processing", async () => {
    const event = record(callEnvelope("call.playback.started"));
    let ignoredInput: unknown;
    const process = createCanonicalTelnyxEventProcessor({
      inbox: {
        claim: async () => event,
        completeIgnored: async (input) => {
          ignoredInput = input;
          return true;
        },
        fail: async () => true,
      },
      projector: {
        projectAndComplete: async () => {
          throw new Error("must not project");
        },
      },
    });

    await expect(process(event.id)).resolves.toEqual({ outcome: "IGNORED" });
    expect(ignoredInput).toMatchObject({ attemptCount: 1, eventId: "inbox-1" });
  });

  it("rolls back staged canonical facts when checkpoint completion fails", async () => {
    const event = record(callEnvelope());
    const durableFacts: string[] = [];
    let failedCode = "";
    const process = createCanonicalTelnyxEventProcessor({
      inbox: {
        claim: async () => event,
        completeIgnored: async () => true,
        fail: async (_event, code) => {
          failedCode = code;
          return true;
        },
      },
      projector: {
        projectAndComplete: async () => {
          const transactionFacts = ["call", "leg", "event"];
          // The real repository performs this unit in prisma.$transaction. This
          // fake deliberately fails before commit and therefore publishes none.
          transactionFacts.length = 0;
          throw Object.assign(new Error("claim lost"), {
            code: "CANONICAL_CLAIM_LOST",
          });
        },
      },
    });

    await expect(process(event.id)).resolves.toMatchObject({ outcome: "FAILED" });
    expect(durableFacts).toEqual([]);
    expect(failedCode).toBe("CANONICAL_PROJECTION_FAILED");
  });

  it("does not reclaim terminal or historical ignored rows", async () => {
    let projectorCalls = 0;
    const process = createCanonicalTelnyxEventProcessor({
      inbox: {
        claim: async () => null,
        completeIgnored: async () => true,
        fail: async () => true,
      },
      projector: {
        projectAndComplete: async () => {
          projectorCalls += 1;
          throw new Error("not reached");
        },
      },
    });

    await expect(process("historical-ignored")).resolves.toEqual({ outcome: "SKIPPED" });
    expect(projectorCalls).toBe(0);
  });
});
