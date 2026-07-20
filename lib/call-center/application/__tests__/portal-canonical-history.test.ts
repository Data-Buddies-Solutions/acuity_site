import { describe, expect, it } from "bun:test";

import {
  CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT,
  canonicalCallAccessWhere,
  readCanonicalCallCenterHistory,
  readCanonicalNeedsAction,
  readCanonicalNeedsActionPreview,
} from "../portal-canonical-history";

const context = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practice: {
    brandAccentColor: null,
    brandLogoAlt: null,
    brandLogoUrl: null,
    brandMarkUrl: null,
    brandPrimaryColor: null,
    id: "practice-1",
    name: "Acuity",
  },
};

const call = {
  answeredAt: null,
  callerName: "Patient",
  direction: "INBOUND",
  endedAt: new Date("2026-07-12T19:01:05.000Z"),
  fromPhone: "+15555550123",
  id: "call-1",
  number: { practicePhoneNumber: { location: { name: "Optical" } } },
  providerCallSessionId: "provider-1",
  receivedAt: new Date("2026-07-12T19:00:00.000Z"),
  status: "VOICEMAIL",
  toPhone: "+15555550000",
  voicemail: null,
  winningLeg: null,
};

describe("canonical portal history", () => {
  it("scopes every call through the authenticated practice-number location", () => {
    expect(canonicalCallAccessWhere(context as never)).toEqual({
      number: {
        practiceId: "practice-1",
        practicePhoneNumber: {
          locationId: { in: ["location-1"] },
          practiceId: "practice-1",
        },
      },
      practiceId: "practice-1",
    });
    expect(canonicalCallAccessWhere(context as never, ["location-2"])).toMatchObject({
      id: { in: [] },
    });
  });

  it("reads unanswered history from the canonical call table", async () => {
    let query: Record<string, unknown> | null = null;
    const database = {
      callCenterCall: {
        count: async () => 1,
        findMany: async (input: Record<string, unknown>) => {
          query = input;
          return [call];
        },
      },
    };
    const result = await readCanonicalCallCenterHistory(
      { range: "all", view: "all" },
      { database: database as never, getContext: async () => context as never },
    );

    expect(query).toMatchObject({ skip: 0, take: 100 });
    expect(
      (query as unknown as { where: Record<string, unknown> }).where,
    ).not.toHaveProperty("effectOwner");
    expect(result?.calls[0]).toMatchObject({
      connected: false,
      id: "call-1",
      locationName: "Optical",
      status: "MISSED",
    });
  });

  it("groups canonical tasks by the patient number on their owning call", async () => {
    let query: Record<string, unknown> | null = null;
    const database = {
      callCenterTask: {
        findMany: async (input: Record<string, unknown>) => {
          query = input;
          return [
            {
              call,
              createdAt: call.endedAt,
              id: "task-1",
              kind: "MISSED_CALL",
              note: null,
            },
          ];
        },
      },
    };
    const result = await readCanonicalNeedsAction(
      { locationIds: ["location-1"], page: 1, pageSize: 25, queueId: "queue-1" },
      { database: database as never, getContext: async () => context as never },
    );

    expect(query).toMatchObject({
      where: { call: { practiceId: "practice-1", queueId: "queue-1" } },
    });
    expect(result).toMatchObject({
      groups: [
        {
          fromPhone: "+15555550123",
          latestKind: "missed",
          missedCount: 1,
          voicemailCount: 0,
        },
      ],
      total: 1,
    });
  });

  it("loads at most 15 records for the independent needs-action preview", async () => {
    let query: Record<string, unknown> | null = null;
    const previewTasks = Array.from(
      { length: CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT + 5 },
      (_, index) => ({
        call: {
          ...call,
          fromPhone: `+15555550${index.toString().padStart(3, "0")}`,
        },
        createdAt: new Date(call.endedAt.getTime() - index * 1_000),
        id: `task-${index}`,
        kind: "MISSED_CALL",
        note: null,
      }),
    );
    const database = {
      callCenterQueue: {
        findFirst: async () => ({
          id: "queue-1",
          locations: [{ locationId: "location-1" }],
          name: "Main queue",
        }),
      },
      callCenterTask: {
        findMany: async (input: Record<string, unknown>) => {
          query = input;
          return previewTasks;
        },
      },
    };

    const result = await readCanonicalNeedsActionPreview(
      {
        allowedLocationIds: ["location-1"],
        hasAllLocationAccess: false,
        practiceId: "practice-1",
        userId: "user-1",
      },
      { locationIds: ["location-1"], queueId: "queue-1" },
      database as never,
    );

    expect(query).toMatchObject({
      take: CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT,
      where: {
        call: { practiceId: "practice-1", queueId: "queue-1" },
        practiceId: "practice-1",
        status: "OPEN",
      },
    });
    expect(result).toHaveLength(CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT);
    expect(result[0]).toMatchObject({ id: "task-0", kind: "missed" });
  });
});
