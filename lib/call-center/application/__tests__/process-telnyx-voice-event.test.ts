import { describe, expect, it } from "bun:test";

import {
  createProviderWebhookInbox,
  type ProviderWebhookInboxStore,
  type ProviderWebhookRecord,
} from "../../infrastructure/provider-webhook-inbox";
import type { TelnyxVoiceWebhookEnvelope } from "../../infrastructure/telnyx-voice-envelope";
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
    errorCode: null,
    eventType: envelope.eventType,
    id: "inbox-1",
    nextAttemptAt: null,
    payload: envelope.body,
    processedAt: null,
    processingStatus: status,
    providerEventId: envelope.providerEventId,
    updatedAt: now,
  };
}

function setup({
  existingStatus = "RECEIVED",
}: { existingStatus?: ProviderWebhookRecord["processingStatus"] } = {}) {
  const completed: Array<Record<string, unknown>> = [];
  const failed: Array<Record<string, unknown>> = [];
  const store: ProviderWebhookInboxStore = {
    claim: async () =>
      existingStatus === "RECEIVED" || existingStatus === "FAILED"
        ? claimedEvent("PROCESSING")
        : null,
    complete: async (input) => {
      completed.push(input);
      return true;
    },
    fail: async (input) => {
      failed.push(input);
      return true;
    },
    receive: async () => claimedEvent(existingStatus),
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
      processingStatus: "PROCESSED",
    });
    expect(projectedBody).toEqual(envelope.body);
    expect(completed).toEqual([
      {
        attemptCount: 1,
        eventId: "inbox-1",
        now,
        status: "PROCESSED",
      },
    ]);
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
});
