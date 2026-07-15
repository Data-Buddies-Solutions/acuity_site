import { describe, expect, it } from "bun:test";

import { resolveCallerThread } from "../prisma-resolve-caller-thread";

const input = {
  actor: {
    allowedLocationIds: ["location-1"],
    hasAllLocationAccess: false,
    practiceId: "practice-1",
    userId: "user-1",
  },
  disposition: "RESOLVED",
  locationIds: ["location-1"],
  now: new Date("2026-07-12T20:00:00.000Z"),
  phoneVariants: ["+15555550123", "15555550123"],
  queueId: "queue-1",
};

describe("canonical caller-thread resolution", () => {
  it("locks, resolves, and records each authorized task", async () => {
    const events: unknown[] = [];
    let where: unknown;
    const result = await resolveCallerThread(input, {
      $transaction: async (operation: (transaction: unknown) => Promise<unknown>) =>
        operation({
          $queryRaw: async () => [{ id: "task-1" }],
          callCenterEvent: {
            create: async ({ data }: { data: unknown }) => events.push(data),
          },
          callCenterTask: {
            findMany: async (query: { where: unknown }) => {
              where = query.where;
              return [{ callId: "call-1", id: "task-1" }];
            },
            updateMany: async () => ({ count: 1 }),
          },
        }),
    } as never);

    expect(where).toMatchObject({
      call: {
        OR: [
          { fromPhone: { in: input.phoneVariants } },
          { toPhone: { in: input.phoneVariants } },
        ],
        practiceId: "practice-1",
        queueId: "queue-1",
      },
      practiceId: "practice-1",
      status: "OPEN",
    });
    expect(events).toEqual([
      expect.objectContaining({
        aggregateId: "task-1",
        idempotencyKey: "caller-thread-resolved:task-1",
        type: "TASK_RESOLVED",
      }),
    ]);
    expect(result).toEqual({ canonicalTasksResolved: 1 });
  });

  it("does nothing when the caller has no open task", async () => {
    let locked = false;
    const result = await resolveCallerThread(input, {
      $transaction: async (operation: (transaction: unknown) => Promise<unknown>) =>
        operation({
          $queryRaw: async () => {
            locked = true;
          },
          callCenterEvent: { create: async () => null },
          callCenterTask: {
            findMany: async () => [],
            updateMany: async () => ({ count: 0 }),
          },
        }),
    } as never);
    expect(result).toEqual({ canonicalTasksResolved: 0 });
    expect(locked).toBe(false);
  });
});
