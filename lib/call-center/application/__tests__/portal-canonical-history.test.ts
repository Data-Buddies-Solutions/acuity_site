import { describe, expect, it } from "bun:test";

import {
  canonicalCallAccessWhere,
  readCanonicalCallerTimeline,
  readCanonicalCallCenterHistory,
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

describe("canonical portal history", () => {
  it("scopes canonical calls through authenticated number locations", () => {
    expect(canonicalCallAccessWhere(context as never)).toEqual({
      effectOwner: "CANONICAL",
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

  it("paginates canonical connected and terminal calls", async () => {
    let query: Record<string, unknown> | null = null;
    const database = {
      callCenterCall: {
        count: async ({ where }: { where: Record<string, unknown> }) => {
          if (where.direction === "INBOUND") return 1;
          if (where.direction === "OUTBOUND" && where.answeredAt) return 1;
          if (where.direction === "OUTBOUND") return 2;
          return 4;
        },
        findMany: async (input: Record<string, unknown>) => {
          query = input;
          return [
            {
              answeredAt: new Date("2026-07-12T19:00:05.000Z"),
              direction: "INBOUND",
              endedAt: new Date("2026-07-12T19:01:05.000Z"),
              fromPhone: "+15555550123",
              id: "call-1",
              number: {
                practicePhoneNumber: { location: { name: "Optical" } },
              },
              receivedAt: new Date("2026-07-12T19:00:00.000Z"),
              status: "COMPLETED",
              toPhone: "+15555550000",
              winningLeg: { endpoint: { label: "Front desk" } },
            },
          ];
        },
      },
    };
    const result = await readCanonicalCallCenterHistory(
      {
        now: new Date("2026-07-12T20:00:00.000Z"),
        page: 2,
        pageSize: 25,
        range: "24h",
        view: "connections",
      },
      {
        database: database as never,
        getContext: async () => context as never,
      },
    );

    expect(query).toMatchObject({
      skip: 25,
      take: 25,
      where: {
        answeredAt: { not: null },
        effectOwner: "CANONICAL",
        receivedAt: { gte: new Date("2026-07-11T20:00:00.000Z") },
        status: {
          in: ["CONNECTED", "WRAP_UP", "COMPLETED"],
        },
      },
    });
    expect(result).toMatchObject({
      calls: [
        {
          answeredBy: "Front desk",
          connected: true,
          durationSec: 60,
          id: "call-1",
          locationName: "Optical",
        },
      ],
      page: 2,
      totals: {
        inboundCalls: 1,
        outboundCalls: 1,
        outboundDialedCalls: 2,
        totalCalls: 4,
      },
    });
  });

  it("includes unanswered outcomes in all-call history", async () => {
    let query: Record<string, unknown> | null = null;
    const database = {
      callCenterCall: {
        count: async () => 1,
        findMany: async (input: Record<string, unknown>) => {
          query = input;
          return [
            {
              answeredAt: null,
              direction: "INBOUND",
              endedAt: new Date("2026-07-12T19:01:05.000Z"),
              fromPhone: "+15555550123",
              id: "call-missed",
              number: {
                practicePhoneNumber: { location: { name: "Optical" } },
              },
              providerCallSessionId: "provider-missed",
              receivedAt: new Date("2026-07-12T19:00:00.000Z"),
              status: "ABANDONED",
              toPhone: "+15555550000",
              winningLeg: null,
            },
          ];
        },
      },
    };
    const result = await readCanonicalCallCenterHistory(
      { page: 1, pageSize: 25, range: "all", view: "all" },
      {
        database: database as never,
        getContext: async () => context as never,
      },
    );

    expect(query).toMatchObject({
      where: {
        effectOwner: "CANONICAL",
      },
    });
    const allCallsWhere = (query as unknown as { where: Record<string, unknown> }).where;
    expect(allCallsWhere.answeredAt).toBeUndefined();
    expect(allCallsWhere.status).toBeUndefined();
    expect(result?.calls[0]).toMatchObject({
      connected: false,
      id: "call-missed",
      status: "MISSED",
    });
  });

  it("paginates open canonical tasks by caller thread", async () => {
    const groupQueries: Array<Record<string, unknown>> = [];
    const taskQueries: Array<Record<string, unknown>> = [];
    const database = {
      callCenterTask: {
        findMany: async (input: Record<string, unknown>) => {
          taskQueries.push(input);
          if ("select" in input) {
            return [
              {
                call: { fromPhone: "+15555550333" },
                createdAt: new Date("2026-07-12T18:55:00.000Z"),
                id: "legacy-missed-task",
              },
            ];
          }
          const call = {
            callerName: "Patient",
            fromPhone: "+15555550333",
            number: {
              practicePhoneNumber: { location: { name: "Optical" } },
            },
            voicemail: { durationSec: 12, recordingId: "recording-1" },
          };
          return [
            {
              call,
              callerPhone: "+15555550333",
              createdAt: new Date("2026-07-12T19:00:00.000Z"),
              id: "task-3",
              kind: "VOICEMAIL",
            },
            {
              call: { ...call, voicemail: null },
              callerPhone: null,
              createdAt: new Date("2026-07-12T18:55:00.000Z"),
              id: "legacy-missed-task",
              kind: "MISSED_CALL",
            },
          ];
        },
        groupBy: async (input: Record<string, unknown>) => {
          groupQueries.push(input);
          return [
            {
              _max: { createdAt: new Date("2026-07-12T21:00:00.000Z") },
              callerPhone: "+15555550111",
            },
            {
              _max: { createdAt: new Date("2026-07-12T20:00:00.000Z") },
              callerPhone: "+15555550222",
            },
            {
              _max: { createdAt: new Date("2026-07-12T19:00:00.000Z") },
              callerPhone: "+15555550333",
            },
            {
              _max: { createdAt: new Date("2026-07-12T18:58:00.000Z") },
              callerPhone: "(555) 555-0333",
            },
          ];
        },
      },
    };
    const result = await readCanonicalNeedsAction(
      { locationIds: ["location-1"], page: 2, pageSize: 2, queueId: "queue-1" },
      {
        database: database as never,
        getContext: async () => context as never,
      },
    );

    expect(groupQueries).toHaveLength(1);
    expect(groupQueries[0]).toMatchObject({ where: { call: { queueId: "queue-1" } } });
    expect(taskQueries[0]).toMatchObject({
      where: { call: { queueId: "queue-1" }, callerPhone: null },
    });
    expect(taskQueries[1]).toMatchObject({
      where: {
        OR: [
          {
            callerPhone: {
              in: expect.arrayContaining(["+15555550333", "(555) 555-0333"]),
            },
          },
          { id: { in: ["legacy-missed-task"] } },
        ],
      },
    });
    expect(result).toMatchObject({
      groups: [
        {
          callerName: "Patient",
          fromPhone: "+15555550333",
          latestKind: "voicemail",
          latestVoicemailDurationSec: 12,
          latestVoicemailRecordingId: "recording-1",
          missedCount: 1,
          voicemailCount: 1,
        },
      ],
      total: 3,
    });
  });

  it("builds an access-scoped paginated caller timeline from canonical calls and tasks", async () => {
    const callQueries: Array<Record<string, unknown>> = [];
    const taskQueries: Array<Record<string, unknown>> = [];
    const calls = Array.from({ length: 25 }, (_, index) => ({
      answeredAt: new Date(
        `2026-07-12T19:${String(30 - index).padStart(2, "0")}:05.000Z`,
      ),
      callerName: "Patient",
      direction: "OUTBOUND",
      endedAt: new Date(`2026-07-12T19:${String(30 - index).padStart(2, "0")}:35.000Z`),
      fromPhone: "+15555550000",
      id: `call-${index + 1}`,
      number: {
        practicePhoneNumber: { location: { name: "Optical" } },
      },
      receivedAt: new Date(
        `2026-07-12T19:${String(30 - index).padStart(2, "0")}:00.000Z`,
      ),
      status: "COMPLETED",
      toPhone: "+15555550123",
      voicemail: null,
      winningLeg: { endpoint: { label: "Front desk" } },
    }));
    const voicemailTask = {
      call: {
        answeredAt: null,
        callerName: "Patient",
        direction: "INBOUND",
        endedAt: new Date("2026-07-12T18:00:30.000Z"),
        fromPhone: "+15555550123",
        id: "voicemail-call",
        number: {
          practicePhoneNumber: { location: { name: "Optical" } },
        },
        receivedAt: new Date("2026-07-12T18:00:00.000Z"),
        status: "VOICEMAIL",
        toPhone: "+15555550000",
        voicemail: {
          durationSec: 18,
          id: "voicemail-1",
          recordingId: "recording-1",
        },
        winningLeg: null,
      },
      callerPhone: "+15555550123",
      createdAt: new Date("2026-07-12T18:00:30.000Z"),
      id: "task-1",
      kind: "VOICEMAIL",
      resolvedAt: null,
      status: "OPEN",
    };
    const database = {
      callCenterCall: {
        count: async ({ where }: { where: Record<string, unknown> }) => {
          if (where.direction === "INBOUND") return 0;
          if (where.direction === "OUTBOUND") return 25;
          return 25;
        },
        findFirst: async () => ({ callerName: "Patient" }),
        findMany: async (input: Record<string, unknown>) => {
          callQueries.push(input);
          return calls;
        },
      },
      callCenterTask: {
        count: async () => 1,
        findFirst: async () => voicemailTask,
        findMany: async (input: Record<string, unknown>) => {
          taskQueries.push(input);
          return [voicemailTask];
        },
      },
    };

    const result = await readCanonicalCallerTimeline(
      "+1 (555) 555-0123",
      {
        locationIds: ["location-1"],
        now: new Date("2026-07-12T20:00:00.000Z"),
        page: 2,
        pageSize: 25,
        range: "24h",
      },
      {
        database: database as never,
        getContext: async () => context as never,
      },
    );

    expect(callQueries[0]).toMatchObject({
      take: 50,
      where: {
        effectOwner: "CANONICAL",
        NOT: {
          tasks: { some: { kind: { in: ["MISSED_CALL", "VOICEMAIL"] } } },
        },
        number: {
          practicePhoneNumber: { locationId: { in: ["location-1"] } },
        },
        receivedAt: { gte: new Date("2026-07-11T20:00:00.000Z") },
      },
    });
    expect(taskQueries[0]).toMatchObject({
      take: 50,
      where: {
        call: {
          effectOwner: "CANONICAL",
          number: {
            practicePhoneNumber: { locationId: { in: ["location-1"] } },
          },
        },
        OR: [
          { callerPhone: { in: expect.arrayContaining(["+15555550123"]) } },
          {
            call: {
              effectOwner: "CANONICAL",
              fromPhone: { in: expect.arrayContaining(["+15555550123"]) },
            },
            callerPhone: null,
          },
        ],
        createdAt: { gte: new Date("2026-07-11T20:00:00.000Z") },
        practiceId: "practice-1",
      },
    });
    expect(result).toMatchObject({
      callerName: "Patient",
      items: [
        {
          durationSec: 18,
          id: "canonical-task:task-1",
          kind: "voicemail",
          recordingId: "recording-1",
          status: "NEEDS_ACTION",
        },
      ],
      latestNeedsActionItem: { id: "canonical-task:task-1" },
      page: 2,
      totalPages: 2,
      totals: {
        inboundItems: 1,
        outboundConnectedCalls: 25,
        outboundDialedCalls: 25,
        totalItems: 26,
      },
    });
  });
});
