import { describe, expect, it } from "bun:test";

import {
  buildCanonicalBatchItems,
  queueCallWhere,
  readCanonicalEventBatch,
  serializeAgentSession,
  serializeCall,
} from "../realtime-queries";

const now = new Date("2026-07-11T12:00:00.000Z");

describe("canonical realtime serializers", () => {
  it("scopes queue calls through the configured practice-number location", () => {
    expect(
      queueCallWhere(
        {
          allowedLocationIds: ["location-1"],
          hasAllLocationAccess: false,
          practiceId: "practice-1",
          userId: "user-1",
        },
        "queue-1",
        ["location-1", "location-2"],
      ),
    ).toEqual({
      number: {
        practiceId: "practice-1",
        practicePhoneNumber: {
          location: { practiceId: "practice-1" },
          locationId: { in: ["location-1"] },
        },
      },
      practiceId: "practice-1",
      queueId: "queue-1",
    });
  });

  it("fails closed for an unscoped queue under selected-location access", () => {
    expect(
      queueCallWhere(
        {
          allowedLocationIds: ["location-1"],
          hasAllLocationAccess: false,
          practiceId: "practice-1",
          userId: "user-1",
        },
        "queue-1",
        [],
      ),
    ).toMatchObject({ id: { in: [] } });
  });

  it("preserves call stateVersion while removing Date and bigint hazards", () => {
    const call = serializeCall({
      answeredAt: null,
      callerName: null,
      direction: "INBOUND",
      endedAt: null,
      fromPhone: "+17865550100",
      id: "call-1",
      legs: [],
      queueId: "queue-1",
      receivedAt: now,
      stateVersion: 12,
      status: "RINGING",
      toPhone: "+17865550101",
      winningLegId: null,
    });

    expect(call.stateVersion).toBe(12);
    expect(call.receivedAt).toBe("2026-07-11T12:00:00.000Z");
  });

  it("uses the canonical client identity and connection vocabulary", () => {
    const session = serializeAgentSession({
      audioReady: false,
      browserSessionId: "tab-1",
      connectionState: "ERROR",
      endpointId: "endpoint-1",
      id: "session-1",
      leaseExpiresAt: now,
      microphoneReady: true,
      presence: "PAUSED",
      stateVersion: 4,
    });

    expect(session).toMatchObject({
      clientInstanceId: "tab-1",
      connectionState: "FAILED",
      stateVersion: 4,
    });
    expect("browserSessionId" in session).toBe(false);
  });

  it("removes resolved tasks and carries absolute convergent counts", () => {
    const counts = { active: 1, openTasks: 0, recent: 2, waiting: 3 };
    const [item] = buildCanonicalBatchItems({
      calls: [],
      counts,
      events: [
        {
          aggregateId: "task-1",
          aggregateType: "TASK",
          revision: BigInt(42),
          type: "TASK_RESOLVED",
        },
      ],
      sessions: [],
      tasks: [
        {
          callId: "call-1",
          id: "task-1",
          kind: "FOLLOW_UP",
          status: "RESOLVED",
        },
      ],
    });

    expect(item.projection).toMatchObject({
      counts,
      delta: { kind: "TASK_REMOVE", taskId: "task-1" },
      revision: "42",
    });
  });

  it("keeps each poll query count constant for a full filtered batch", async () => {
    async function run(eventCount: number) {
      let queries = 0;
      const counted =
        <T>(value: T) =>
        async () => {
          queries += 1;
          return value;
        };
      const transaction = {
        callCenterAgentSession: { findMany: counted([]) },
        callCenterCall: {
          count: counted(0),
          findMany: counted([]),
        },
        callCenterEvent: {
          findMany: counted(
            Array.from({ length: eventCount }, (_, index) => ({
              aggregateId: `other-call-${index}`,
              aggregateType: "CALL",
              revision: BigInt(index + 1),
              type: "CALL_UPDATED",
            })),
          ),
        },
        callCenterQueue: {
          findFirst: counted({
            id: "queue-1",
            locations: [{ locationId: "location-1" }],
            maxWaitSec: 30,
            name: "Optical",
            ringTimeoutSec: 20,
          }),
        },
        callCenterTask: {
          count: counted(0),
          findMany: counted([]),
        },
        practiceMembership: {
          findUnique: counted({ locationScope: "ALL", locations: [] }),
        },
      };
      const database = {
        $transaction: async (work: (value: unknown) => unknown) => work(transaction),
      } as never;

      const batch = await readCanonicalEventBatch(
        { practiceId: "practice-1", userId: "user-1" },
        "queue-1",
        BigInt(0),
        database,
      );
      return { batch, queries };
    }

    const one = await run(1);
    const full = await run(100);
    expect(full.queries).toBe(one.queries);
    expect(full.batch.items).toHaveLength(100);
    expect(full.batch.scannedThrough).toBe(BigInt(100));
  });
});
