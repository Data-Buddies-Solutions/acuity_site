import { describe, expect, test } from "bun:test";

import {
  createTelnyxVoiceEventProcessor,
  providerEventErrorCode,
} from "../process-telnyx-voice-event";
import { CanonicalProjectionError } from "../../infrastructure/prisma-canonical-call-projector";
import { TelnyxEventAdmissionError } from "../../infrastructure/prisma-telnyx-event-admission";

const receivedAt = new Date("2026-07-19T12:00:00.000Z");
const envelope = {
  body: {
    data: {
      event_type: "call.answered",
      id: "provider-event-1",
      occurred_at: receivedAt.toISOString(),
      payload: {
        call_control_id: "customer-control-1",
        call_leg_id: "customer-leg-1",
        call_session_id: "customer-session-1",
        direction: "incoming",
        from: "+17865550100",
        to: "+17865550101",
      },
    },
  },
  eventType: "call.answered",
  occurredAt: receivedAt,
  providerEventId: "provider-event-1",
};

const event = {
  attemptCount: 1,
  directHandoffTokenHash: null,
  errorCode: null,
  eventType: envelope.eventType,
  id: "event-1",
  nextAttemptAt: null,
  payload: envelope.body,
  processedAt: null,
  processingStatus: "PROCESSING" as const,
  providerCallSessionId: "customer-session-1",
  providerEventId: envelope.providerEventId,
  receivedAt,
  updatedAt: receivedAt,
};

describe("Telnyx provider-event lifecycle", () => {
  test("exposes categorical errors without exception details", () => {
    expect(
      providerEventErrorCode(
        new CanonicalProjectionError("CANONICAL_QUEUE_NOT_CONFIGURED"),
      ),
    ).toBe("CANONICAL_QUEUE_NOT_CONFIGURED");
    expect(providerEventErrorCode({ code: "P2022" })).toBe("CANONICAL_PRISMA_P2022");
    expect(providerEventErrorCode(new Error("sensitive detail"))).toBe(
      "PROVIDER_EVENT_FAILED",
    );
  });

  test("admits and projects one verified envelope through one durable outcome", async () => {
    const calls: string[] = [];
    const process = createTelnyxVoiceEventProcessor({
      admit: async (claimed) => {
        calls.push(`admit:${claimed.id}`);
      },
      dispatchCommand: async (commandId) => {
        calls.push(`dispatch:${commandId}`);
        return {
          commandId,
          markSent: "MARKED",
          status: "DISPATCHED",
        };
      },
      inbox: {
        claim: async () => {
          calls.push("claim");
          return { decision: "CLAIM" as const, event };
        },
        completeIgnored: async () => true,
        fail: async () => true,
        receive: async () => {
          calls.push("receive");
          return event;
        },
        retryAt: () => receivedAt,
      },
      projector: {
        projectAndComplete: async (claimed, fact) => {
          calls.push(`project:${claimed.id}:${fact.eventType}`);
          return {
            callId: "call-1",
            callStatus: "RINGING",
            commandIds: ["dial-agent-1", "dial-agent-2"],
            legId: "customer-leg-1",
            legStatus: "ANSWERED",
            practiceId: "practice-1",
          };
        },
      },
    });

    await expect(process(envelope)).resolves.toMatchObject({
      duplicate: false,
      outcome: "PROCESSED",
      projection: { callId: "call-1" },
      providerWebhookEventId: "event-1",
    });
    expect(calls).toEqual([
      "receive",
      "claim",
      "admit:event-1",
      "project:event-1:call.answered",
      "dispatch:dial-agent-1",
      "dispatch:dial-agent-2",
    ]);
  });

  test("represents an out-of-scope envelope as one terminal ignored outcome", async () => {
    const completions: Array<Record<string, unknown>> = [];
    const process = createTelnyxVoiceEventProcessor({
      admit: async () => {
        throw new TelnyxEventAdmissionError("TELNYX_EVENT_OUT_OF_SCOPE");
      },
      clock: () => receivedAt,
      inbox: {
        claim: async () => ({ decision: "CLAIM" as const, event }),
        completeIgnored: async (input) => {
          completions.push(input);
          return true;
        },
        fail: async () => true,
        receive: async () => event,
        retryAt: () => receivedAt,
      },
      projector: {
        projectAndComplete: async () => {
          throw new Error("projection must not run");
        },
      },
    });

    await expect(process(envelope)).resolves.toMatchObject({
      duplicate: false,
      errorCode: "TELNYX_EVENT_OUT_OF_SCOPE",
      outcome: "IGNORED",
    });
    expect(completions).toEqual([
      {
        attemptCount: 1,
        errorCode: "TELNYX_EVENT_OUT_OF_SCOPE",
        eventId: "event-1",
        now: receivedAt,
      },
    ]);
  });

  test("exposes one retry state when projection fails", async () => {
    const failures: Array<Record<string, unknown>> = [];
    const process = createTelnyxVoiceEventProcessor({
      admit: async () => "ADMITTED",
      inbox: {
        claim: async () => ({ decision: "CLAIM" as const, event }),
        completeIgnored: async () => true,
        fail: async (input) => {
          failures.push(input);
          return true;
        },
        receive: async () => event,
        retryAt: () => receivedAt,
      },
      projector: {
        projectAndComplete: async () => {
          throw new CanonicalProjectionError("CANONICAL_QUEUE_NOT_CONFIGURED");
        },
      },
    });

    await expect(process(envelope)).resolves.toMatchObject({
      duplicate: false,
      errorCode: "CANONICAL_QUEUE_NOT_CONFIGURED",
      outcome: "FAILED",
    });
    expect(failures).toEqual([
      {
        attemptCount: 1,
        errorCode: "CANONICAL_QUEUE_NOT_CONFIGURED",
        eventId: "event-1",
        nextAttemptAt: receivedAt,
      },
    ]);
  });

  test("does not report failure when the durable retry update loses its claim", async () => {
    const process = createTelnyxVoiceEventProcessor({
      admit: async () => "ADMITTED",
      inbox: {
        claim: async () => ({ decision: "CLAIM" as const, event }),
        completeIgnored: async () => true,
        fail: async () => false,
        receive: async () => event,
        retryAt: () => receivedAt,
      },
      projector: {
        projectAndComplete: async () => {
          throw new CanonicalProjectionError("CANONICAL_QUEUE_NOT_CONFIGURED");
        },
      },
    });

    await expect(process(envelope)).rejects.toMatchObject({
      code: "PROVIDER_EVENT_CLAIM_LOST",
    });
  });

  test("deduplicates a terminal event without a second projection", async () => {
    const terminal = { ...event, processingStatus: "PROCESSED" as const };
    const process = createTelnyxVoiceEventProcessor({
      admit: async () => {
        throw new Error("admission must not run");
      },
      inbox: {
        claim: async () => ({ decision: "DUPLICATE" as const, event: null }),
        completeIgnored: async () => true,
        fail: async () => true,
        receive: async () => terminal,
        retryAt: () => receivedAt,
      },
      projector: {
        projectAndComplete: async () => {
          throw new Error("projection must not run");
        },
      },
    });

    await expect(process(envelope)).resolves.toEqual({
      duplicate: true,
      outcome: "PROCESSED",
      providerWebhookEventId: "event-1",
    });
  });
});
