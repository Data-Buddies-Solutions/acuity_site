import { describe, expect, it } from "bun:test";

import type { ProviderWebhookRecord } from "../../infrastructure/provider-webhook-inbox";
import { createProviderWebhookRecovery } from "../recover-provider-webhooks";

const now = new Date("2026-07-11T12:00:00.000Z");

function record(id: string): ProviderWebhookRecord {
  return {
    attemptCount: 0,
    errorCode: null,
    eventType: "call.initiated",
    id,
    nextAttemptAt: null,
    payload: {
      data: {
        event_type: "call.initiated",
        id,
        payload: { call_control_id: `call-${id}` },
      },
    },
    processedAt: null,
    processingStatus: "RECEIVED",
    providerEventId: id,
    updatedAt: now,
  };
}

describe("provider webhook recovery", () => {
  it("is a safe no-op while durable ingress is disabled", async () => {
    let storeCalls = 0;
    const recover = createProviderWebhookRecovery({
      config: () => ({ enabled: false, payloadRetentionDays: null }),
      inbox: {
        listRecoverable: async () => {
          storeCalls += 1;
          return [];
        },
        redactPayloads: async () => {
          storeCalls += 1;
          return 0;
        },
      },
      processEvent: async () => {
        throw new Error("must not process");
      },
    });

    await expect(recover()).resolves.toEqual({
      enabled: false,
      failed: 0,
      recovered: 0,
      redacted: 0,
      selected: 0,
    });
    expect(storeCalls).toBe(0);
  });

  it("continues payload redaction while durable ingress is disabled", async () => {
    let recoveryCalls = 0;
    let redactionInput: { before: Date; limit?: number } | undefined;
    const recover = createProviderWebhookRecovery({
      clock: () => now,
      config: () => ({ enabled: false, payloadRetentionDays: 3 }),
      inbox: {
        listRecoverable: async () => {
          recoveryCalls += 1;
          return [];
        },
        redactPayloads: async (input) => {
          redactionInput = input;
          return 2;
        },
      },
      processEvent: async () => {
        throw new Error("must not process");
      },
    });

    await expect(recover()).resolves.toEqual({
      enabled: false,
      failed: 0,
      recovered: 0,
      redacted: 2,
      selected: 0,
    });
    expect(recoveryCalls).toBe(0);
    expect(redactionInput).toEqual({
      before: new Date("2026-07-08T12:00:00.000Z"),
      limit: 100,
    });
  });

  it("processes a bounded batch sequentially and continues after failures", async () => {
    const events = [record("event-1"), record("event-2"), record("event-3")];
    let requestedLimit = 0;
    let active = 0;
    let peakActive = 0;
    const processed: string[] = [];
    const recover = createProviderWebhookRecovery({
      clock: () => now,
      config: () => ({ enabled: true, payloadRetentionDays: 7 }),
      inbox: {
        listRecoverable: async (limit) => {
          requestedLimit = limit ?? -1;
          return events;
        },
        redactPayloads: async () => 4,
      },
      processEvent: async (envelope) => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        processed.push(envelope.providerEventId);
        await Promise.resolve();
        active -= 1;
        if (envelope.providerEventId === "event-2") {
          throw new Error("temporary projection failure");
        }
        return { duplicate: false, processingStatus: "PROCESSED" };
      },
    });

    await expect(recover()).resolves.toEqual({
      enabled: true,
      failed: 1,
      recovered: 2,
      redacted: 4,
      selected: 3,
    });
    expect(requestedLimit).toBe(5);
    expect(peakActive).toBe(1);
    expect(processed).toEqual(["event-1", "event-2", "event-3"]);
  });

  it("redacts terminal payloads before the configured retention boundary", async () => {
    let redactionInput: { before: Date; limit?: number } | undefined;
    const recover = createProviderWebhookRecovery({
      clock: () => now,
      config: () => ({ enabled: true, payloadRetentionDays: 3 }),
      inbox: {
        listRecoverable: async () => [],
        redactPayloads: async (input) => {
          redactionInput = input;
          return 1;
        },
      },
      processEvent: async () => ({
        duplicate: false,
        processingStatus: "PROCESSED",
      }),
    });

    await recover();

    expect(redactionInput).toEqual({
      before: new Date("2026-07-08T12:00:00.000Z"),
      limit: 100,
    });
  });
});
