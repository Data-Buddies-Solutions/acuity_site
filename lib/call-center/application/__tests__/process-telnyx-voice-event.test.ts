import { describe, expect, it } from "bun:test";

import {
  createProviderWebhookInbox,
  type ProviderWebhookInboxStore,
  type ProviderWebhookRecord,
} from "../../infrastructure/provider-webhook-inbox";
import type { TelnyxVoiceWebhookEnvelope } from "../../infrastructure/telnyx-voice-envelope";
import { TelnyxEventOwnerError } from "../../infrastructure/telnyx-event-owner";
import {
  createTelnyxVoiceEventProcessor,
  ProviderWebhookProcessingPendingError,
} from "../process-telnyx-voice-event";

const now = new Date("2026-07-11T12:00:00.000Z");
const retryAt = new Date("2026-07-11T12:00:05.000Z");
const envelope: TelnyxVoiceWebhookEnvelope = {
  body: {
    data: {
      event_type: "call.initiated",
      id: "event-1",
      payload: { call_control_id: "call-1" },
    },
  },
  eventType: "call.initiated",
  occurredAt: now,
  providerEventId: "event-1",
};

function claimedEvent(
  status: ProviderWebhookRecord["processingStatus"] = "RECEIVED",
): ProviderWebhookRecord {
  return {
    attemptCount: status === "PROCESSING" ? 1 : 0,
    directHandoffTokenHash: null,
    effectOwner: null,
    errorCode: null,
    eventType: envelope.eventType,
    id: "inbox-1",
    nextAttemptAt: null,
    payload: envelope.body,
    processedAt: null,
    processingStatus: status,
    providerCallSessionId: null,
    providerEventId: envelope.providerEventId,
    updatedAt: now,
  };
}

function setup({
  existingStatus = "RECEIVED",
  storedPayload = envelope.body,
}: {
  existingStatus?: ProviderWebhookRecord["processingStatus"];
  storedPayload?: unknown;
} = {}) {
  const completed: Array<Record<string, unknown>> = [];
  const failed: Array<Record<string, unknown>> = [];
  const store: ProviderWebhookInboxStore = {
    claim: async () => {
      if (existingStatus !== "RECEIVED" && existingStatus !== "FAILED") return null;
      return { ...claimedEvent("PROCESSING"), payload: storedPayload };
    },
    complete: async (input) => {
      completed.push(input);
      return true;
    },
    fail: async (input) => {
      failed.push(input);
      return true;
    },
    receive: async () => ({ ...claimedEvent(existingStatus), payload: storedPayload }),
  };
  const inbox = createProviderWebhookInbox(store, { clock: () => now });
  inbox.retryAt = () => retryAt;

  return { completed, failed, inbox };
}

describe("Telnyx voice event processor", () => {
  it("projects and completes a new event once", async () => {
    const { completed, inbox } = setup();
    let projectedBody: unknown;
    const process = createTelnyxVoiceEventProcessor({
      clock: () => now,
      inbox,
      projectLegacyEvent: async (body) => {
        projectedBody = body;
        return { ok: true };
      },
    });

    await expect(process(envelope)).resolves.toMatchObject({
      duplicate: false,
      providerWebhookEventId: "inbox-1",
      processingStatus: "PROCESSED",
    });
    expect(projectedBody).toEqual(envelope.body);
    expect(completed).toEqual([
      {
        attemptCount: 1,
        effectOwner: "LEGACY",
        eventId: "inbox-1",
        now,
        status: "PROCESSED",
      },
    ]);
  });

  it("resolves ownership from the claimed durable payload", async () => {
    const storedPayload = {
      data: {
        event_type: "call.initiated",
        id: "event-1",
        payload: { call_session_id: "stored-session" },
      },
    };
    const { inbox } = setup({ storedPayload });
    let ownerPayload: unknown;
    let projectedPayload: unknown;
    const process = createTelnyxVoiceEventProcessor({
      inbox,
      projectLegacyEvent: async (payload) => {
        projectedPayload = payload;
        return { ok: true };
      },
      resolveOwner: async (event) => {
        ownerPayload = event.payload;
        return "LEGACY";
      },
    });

    const conflictingEnvelope = {
      ...envelope,
      body: {
        data: {
          event_type: "call.initiated",
          id: "event-1",
          payload: { call_session_id: "conflicting-session" },
        },
      },
    } satisfies TelnyxVoiceWebhookEnvelope;
    await process(conflictingEnvelope);

    expect(ownerPayload).toEqual(storedPayload);
    expect(projectedPayload).toEqual(storedPayload);
  });

  it("records an intentionally ignored projection", async () => {
    const { completed, inbox } = setup();
    const process = createTelnyxVoiceEventProcessor({
      clock: () => now,
      inbox,
      projectLegacyEvent: async () => ({ ignored: true, reason: "unsupported" }),
    });

    await expect(process(envelope)).resolves.toMatchObject({
      duplicate: false,
      ignored: true,
      processingStatus: "IGNORED",
    });
    expect(completed[0]?.status).toBe("IGNORED");
  });

  it("marks ACTIVE ingress ignored without invoking legacy effects", async () => {
    const { completed, inbox } = setup();
    let legacyCalls = 0;
    const process = createTelnyxVoiceEventProcessor({
      clock: () => now,
      inbox,
      projectLegacyEvent: async () => {
        legacyCalls += 1;
        return { ok: true };
      },
      resolveOwner: async () => "CANONICAL",
    });

    await expect(process(envelope)).resolves.toMatchObject({
      ignored: true,
      processingStatus: "IGNORED",
      reason: "canonical_owner",
    });
    expect(legacyCalls).toBe(0);
    expect(completed[0]?.status).toBe("IGNORED");
  });

  it("skips a completed duplicate without projecting again", async () => {
    const { inbox } = setup({ existingStatus: "PROCESSED" });
    let projectionCount = 0;
    const process = createTelnyxVoiceEventProcessor({
      inbox,
      projectLegacyEvent: async () => {
        projectionCount += 1;
        return { ok: true };
      },
    });

    await expect(process(envelope)).resolves.toEqual({
      duplicate: true,
      providerWebhookEventId: "inbox-1",
      processingStatus: "PROCESSED",
    });
    expect(projectionCount).toBe(0);
  });

  it("returns a retryable error before a failed event is due", async () => {
    const { inbox } = setup({ existingStatus: "FAILED" });
    const futureRetry = new Date(now.getTime() + 1);
    const failedEvent = claimedEvent("FAILED");
    failedEvent.nextAttemptAt = futureRetry;
    inbox.receive = async () => failedEvent;
    const process = createTelnyxVoiceEventProcessor({
      clock: () => now,
      inbox,
      projectLegacyEvent: async () => ({ ok: true }),
    });

    await expect(process(envelope)).rejects.toBeInstanceOf(
      ProviderWebhookProcessingPendingError,
    );
  });

  it("returns a retryable error while another request owns the claim", async () => {
    const { inbox } = setup({ existingStatus: "PROCESSING" });
    const process = createTelnyxVoiceEventProcessor({
      clock: () => now,
      inbox,
      projectLegacyEvent: async () => ({ ok: true }),
    });

    let error: unknown;
    try {
      await process(envelope);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ProviderWebhookProcessingPendingError);
    expect((error as ProviderWebhookProcessingPendingError).status).toBe(503);
  });

  it("returns an explicit terminal result after attempts are exhausted", async () => {
    const { inbox } = setup({ existingStatus: "FAILED" });
    const exhausted = claimedEvent("FAILED");
    exhausted.attemptCount = 8;
    exhausted.errorCode = "legacy_projection_failed";
    inbox.receive = async () => exhausted;
    let projectionCount = 0;
    const process = createTelnyxVoiceEventProcessor({
      clock: () => now,
      inbox,
      projectLegacyEvent: async () => {
        projectionCount += 1;
        return { ok: true };
      },
    });

    await expect(process(envelope)).resolves.toEqual({
      errorCode: "legacy_projection_failed",
      exhausted: true,
      providerWebhookEventId: "inbox-1",
      processingStatus: "FAILED",
    });
    expect(projectionCount).toBe(0);
  });

  it("records retry metadata and preserves the projection failure", async () => {
    const { failed, inbox } = setup();
    const projectionError = new Error("projection failed");
    const process = createTelnyxVoiceEventProcessor({
      inbox,
      projectLegacyEvent: async () => {
        throw projectionError;
      },
    });

    await expect(process(envelope)).rejects.toBe(projectionError);
    expect(failed).toEqual([
      {
        attemptCount: 1,
        errorCode: "legacy_projection_failed",
        eventId: "inbox-1",
        nextAttemptAt: retryAt,
      },
    ]);
  });

  it("records owner-resolution failure without invoking either projector", async () => {
    const { failed, inbox } = setup();
    let projectionCount = 0;
    const ownerError = new Error("owner unavailable");
    const process = createTelnyxVoiceEventProcessor({
      inbox,
      projectLegacyEvent: async () => {
        projectionCount += 1;
        return { ok: true };
      },
      resolveOwner: async () => {
        throw ownerError;
      },
    });

    await expect(process(envelope)).rejects.toBe(ownerError);
    expect(projectionCount).toBe(0);
    expect(failed[0]?.errorCode).toBe("event_owner_resolution_failed");
  });

  it("preserves a categorical owner-resolution failure", async () => {
    const { failed, inbox } = setup();
    const ownerError = new TelnyxEventOwnerError("TELNYX_EVENT_IDENTITY_MISMATCH");
    const process = createTelnyxVoiceEventProcessor({
      inbox,
      projectLegacyEvent: async () => ({ ok: true }),
      resolveOwner: async () => {
        throw ownerError;
      },
    });

    await expect(process(envelope)).rejects.toBe(ownerError);
    expect(failed[0]?.errorCode).toBe("TELNYX_EVENT_IDENTITY_MISMATCH");
  });

  it("terminates a rejected direct handoff without scheduling retries", async () => {
    const { completed, failed, inbox } = setup();
    const ownerError = new TelnyxEventOwnerError("TELNYX_DIRECT_HANDOFF_TOKEN_INVALID");
    const process = createTelnyxVoiceEventProcessor({
      clock: () => now,
      inbox,
      projectLegacyEvent: async () => ({ ok: true }),
      resolveOwner: async () => {
        throw ownerError;
      },
    });

    await expect(process(envelope)).resolves.toMatchObject({
      ignored: true,
      processingStatus: "IGNORED",
      reason: "TELNYX_DIRECT_HANDOFF_TOKEN_INVALID",
    });
    expect(completed[0]).toMatchObject({
      effectOwner: null,
      errorCode: "TELNYX_DIRECT_HANDOFF_TOKEN_INVALID",
      status: "IGNORED",
    });
    expect(failed).toHaveLength(0);
  });

  it("separates inbox completion failure from projection failure", async () => {
    const { failed, inbox } = setup();
    inbox.complete = async () => false;
    const process = createTelnyxVoiceEventProcessor({
      inbox,
      projectLegacyEvent: async () => ({ ok: true }),
    });

    await expect(process(envelope)).rejects.toThrow(
      "Provider webhook processing claim was lost",
    );
    expect(failed[0]?.errorCode).toBe("provider_webhook_completion_failed");
  });
});
