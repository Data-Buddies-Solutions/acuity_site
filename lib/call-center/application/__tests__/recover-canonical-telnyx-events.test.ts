import { describe, expect, it } from "bun:test";

import type { CanonicalProjectionRecord } from "../../infrastructure/canonical-provider-webhook-inbox";
import { createCanonicalTelnyxRecovery } from "../recover-canonical-telnyx-events";

function event(id: string): CanonicalProjectionRecord {
  const now = new Date("2026-07-11T12:00:00Z");
  return {
    canonicalProjectionAttemptCount: 0,
    canonicalProjectionErrorCode: null,
    canonicalProjectionNextAttemptAt: null,
    canonicalProjectionStatus: "RECEIVED",
    eventType: "call.initiated",
    id,
    payload: {},
    providerEventId: id,
    receivedAt: now,
    updatedAt: now,
  };
}

describe("canonical projection recovery", () => {
  it("is a default-off no-op", async () => {
    let reads = 0;
    const recover = createCanonicalTelnyxRecovery({
      config: () => ({ enabled: false }),
      inbox: { listRecoverable: async () => ((reads += 1), []) },
      processEvent: async () => ({ outcome: "SKIPPED" }),
    });

    await expect(recover()).resolves.toEqual({
      enabled: false,
      failed: 0,
      ignored: 0,
      projected: 0,
      selected: 0,
    });
    expect(reads).toBe(0);
  });

  it("processes a bounded batch sequentially and reports only counts", async () => {
    const events = [event("1"), event("2"), event("3")];
    const order: string[] = [];
    let limit = 0;
    const recover = createCanonicalTelnyxRecovery({
      config: () => ({ enabled: true }),
      inbox: {
        listRecoverable: async (requested) => {
          limit = requested;
          return events;
        },
      },
      processEvent: async (id) => {
        order.push(id);
        return id === "1"
          ? { outcome: "PROCESSED", projection: {} as never }
          : id === "2"
            ? { outcome: "IGNORED" }
            : { errorCode: "BOUNDED", outcome: "FAILED" };
      },
    });

    await expect(recover()).resolves.toEqual({
      enabled: true,
      failed: 1,
      ignored: 1,
      projected: 1,
      selected: 3,
    });
    expect(limit).toBe(5);
    expect(order).toEqual(["1", "2", "3"]);
  });
});
