import { describe, expect, it } from "bun:test";

import { resolveCallerThread } from "../prisma-resolve-caller-thread";

const input = {
  actor: {
    allowedLocationIds: ["location-1"],
    hasAllLocationAccess: false,
    practiceId: "practice-1",
    userId: "user-1",
  },
  canonicalLocationIds: ["location-1"],
  disposition: "RESOLVED",
  legacyMissedCallWhere: { locationId: "location-1" },
  legacyNoteWhere: { locationId: "location-1" },
  legacyVoicemailWhere: { locationId: "location-1" },
  now: new Date("2026-07-12T20:00:00.000Z"),
  phoneVariants: ["+15555550123", "15555550123"],
  queueId: "queue-1",
};

describe("mixed caller-thread resolution", () => {
  it("resolves authorized canonical tasks and legacy rows in one transaction", async () => {
    const events: unknown[] = [];
    const legacy: string[] = [];
    const taskQueries: Array<Record<string, unknown>> = [];
    let transactions = 0;
    let taskReads = 0;
    const result = await resolveCallerThread(input, {
      $transaction: async (operation: (transaction: unknown) => Promise<unknown>) => {
        transactions += 1;
        return operation({
          $queryRaw: async () => [{ id: "task-1" }],
          callCenterEvent: {
            create: async ({ data }: { data: unknown }) => {
              events.push(data);
              return data;
            },
          },
          callCenterMissedCall: {
            updateMany: async () => {
              legacy.push("missed");
              return { count: 1 };
            },
          },
          callCenterNote: {
            updateMany: async () => {
              legacy.push("note");
              return { count: 1 };
            },
          },
          callCenterTask: {
            findMany: async ({ where }: { where: Record<string, unknown> }) => {
              taskQueries.push(where);
              taskReads += 1;
              return taskReads === 1
                ? [{ id: "task-1" }]
                : [{ callId: "call-1", id: "task-1" }];
            },
            updateMany: async () => ({ count: 1 }),
          },
          callCenterVoicemail: {
            updateMany: async () => {
              legacy.push("voicemail");
              return { count: 1 };
            },
          },
        });
      },
    } as never);

    expect(transactions).toBe(1);
    expect(legacy.sort()).toEqual(["missed", "note", "voicemail"]);
    expect(taskQueries[0]).toMatchObject({
      call: {
        effectOwner: "CANONICAL",
        number: {
          practicePhoneNumber: { locationId: { in: ["location-1"] } },
        },
        practiceId: "practice-1",
        queueId: "queue-1",
      },
      OR: [
        { callerPhone: { in: input.phoneVariants } },
        {
          call: {
            effectOwner: "CANONICAL",
            fromPhone: { in: input.phoneVariants },
            practiceId: "practice-1",
            queueId: "queue-1",
          },
          callerPhone: null,
        },
      ],
      practiceId: "practice-1",
      status: "OPEN",
    });
    expect(events).toEqual([
      expect.objectContaining({
        actorUserId: "user-1",
        aggregateId: "task-1",
        aggregateType: "TASK",
        data: {
          callId: "call-1",
          disposition: "RESOLVED",
          source: "CALLER_THREAD",
        },
        idempotencyKey: "caller-thread-resolved:task-1",
        practiceId: "practice-1",
        type: "TASK_RESOLVED",
      }),
    ]);
    expect(result).toEqual({ canonicalTasksResolved: 1 });
  });

  it("does not append duplicate evidence when a task closes while waiting for its lock", async () => {
    let reads = 0;
    let events = 0;
    const result = await resolveCallerThread(input, {
      $transaction: async (operation: (transaction: unknown) => Promise<unknown>) =>
        operation({
          $queryRaw: async () => [],
          callCenterEvent: { create: async () => (events += 1) },
          callCenterMissedCall: { updateMany: async () => ({ count: 0 }) },
          callCenterNote: { updateMany: async () => ({ count: 0 }) },
          callCenterTask: {
            findMany: async () => (++reads === 1 ? [{ id: "task-1" }] : []),
            updateMany: async () => ({ count: 0 }),
          },
          callCenterVoicemail: { updateMany: async () => ({ count: 0 }) },
        }),
    } as never);

    expect(result).toEqual({ canonicalTasksResolved: 0 });
    expect(events).toBe(0);
  });
});
