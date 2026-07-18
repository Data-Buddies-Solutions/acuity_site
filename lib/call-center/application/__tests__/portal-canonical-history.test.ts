import { describe, expect, it } from "bun:test";

import {
  canonicalCallAccessWhere,
  readCanonicalCallCenterHistory,
  readCanonicalCallerTimeline,
  readCanonicalNeedsAction,
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

  it("merges only authorized SMS messages into the caller timeline", async () => {
    let smsQuery: Record<string, unknown> | null = null;
    const createdAt = new Date("2026-07-12T20:00:00.000Z");
    const emptySource = {
      count: async () => 0,
      findFirst: async () => null,
      findMany: async () => [],
    };
    const database = {
      callCenterCall: emptySource,
      callCenterTask: emptySource,
      smsMessage: {
        count: async (input: { where?: { direction?: string } }) =>
          input.where?.direction === "INBOUND" ? 1 : 2,
        findMany: async (input: Record<string, unknown>) => {
          smsQuery = input;
          return [
            {
              body: "Second at the same time",
              conversation: {
                location: { name: "Optical" },
                patientPhoneNumber: "+15555550123",
              },
              createdAt,
              direction: "OUTBOUND",
              id: "message-2",
              sentByUser: { name: "Operator" },
              status: "DELIVERED",
            },
            {
              body: "First at the same time",
              conversation: {
                location: { name: "Optical" },
                patientPhoneNumber: "+15555550123",
              },
              createdAt,
              direction: "INBOUND",
              id: "message-1",
              sentByUser: null,
              status: "RECEIVED",
            },
          ];
        },
      },
    };

    const result = await readCanonicalCallerTimeline(
      "+15555550123",
      { locationIds: ["location-1"], range: "all" },
      {
        database: database as never,
        getAllowedSmsNumbers: async () => [
          { id: "sms-number-1", locationId: "location-1" },
        ],
        getContext: async () => context as never,
      },
    );

    expect(smsQuery).toMatchObject({
      where: {
        conversation: {
          locationId: { in: ["location-1"] },
          practiceId: "practice-1",
          practiceNumberId: { in: ["sms-number-1"] },
        },
      },
    });
    expect(result).toMatchObject({
      canText: true,
      items: [
        { body: "First at the same time", id: "sms:message-1", kind: "text" },
        { body: "Second at the same time", id: "sms:message-2", kind: "text" },
      ],
      totals: { inboundItems: 1, totalItems: 2 },
      textInboxId: "sms-number-1",
    });
  });
});
