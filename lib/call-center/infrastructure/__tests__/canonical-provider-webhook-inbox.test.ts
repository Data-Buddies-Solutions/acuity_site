import { describe, expect, it } from "bun:test";

import {
  canonicalProjectionMainLaneWhere,
  canonicalProjectionRetryAt,
  createCanonicalProjectionInbox,
  type CanonicalProjectionInboxStore,
  type CanonicalProjectionRecord,
} from "../canonical-provider-webhook-inbox";

const now = new Date("2026-07-11T12:00:00.000Z");

function event(): CanonicalProjectionRecord {
  return {
    canonicalProjectionAttemptCount: 1,
    canonicalProjectionErrorCode: null,
    canonicalProjectionNextAttemptAt: null,
    canonicalProjectionStatus: "PROCESSING",
    effectOwner: "CANONICAL",
    eventType: "call.initiated",
    id: "event-1",
    payload: {},
    providerCallSessionId: "session-1",
    providerEventId: "provider-event-1",
    receivedAt: now,
    updatedAt: now,
  };
}

function store(
  overrides: Partial<CanonicalProjectionInboxStore> = {},
): CanonicalProjectionInboxStore {
  return {
    claim: async () => event(),
    completeIgnored: async () => true,
    fail: async () => true,
    hasIgnoredLegacySession: async () => false,
    listRecoverable: async () => [],
    ...overrides,
  };
}

describe("canonical projection inbox", () => {
  it("waits for the main effect lane to become terminal", () => {
    expect(canonicalProjectionMainLaneWhere).toEqual({
      processingStatus: { in: ["PROCESSED", "IGNORED"] },
    });
  });

  it("claims and lists with an independent bounded lease", async () => {
    const claims: unknown[] = [];
    const listings: unknown[] = [];
    const inbox = createCanonicalProjectionInbox(
      store({
        claim: async (input) => (claims.push(input), event()),
        listRecoverable: async (input) => (listings.push(input), [event()]),
      }),
      { clock: () => now },
    );

    await expect(inbox.claim("event-1")).resolves.toEqual(event());
    await expect(inbox.listRecoverable(10_000)).resolves.toEqual([event()]);
    expect(claims).toEqual([
      {
        eventId: "event-1",
        maxAttempts: 8,
        now,
        staleBefore: new Date("2026-07-11T11:55:00.000Z"),
      },
    ]);
    expect(listings).toEqual([
      {
        limit: 25,
        maxAttempts: 8,
        now,
        staleBefore: new Date("2026-07-11T11:55:00.000Z"),
      },
    ]);
  });

  it("stops scheduling retries at the attempt bound", () => {
    expect(canonicalProjectionRetryAt(1, now)).toEqual(
      new Date("2026-07-11T12:00:05.000Z"),
    );
    expect(canonicalProjectionRetryAt(8, now)).toBeNull();
  });
});
