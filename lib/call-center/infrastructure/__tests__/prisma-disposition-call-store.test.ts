import { describe, expect, it } from "bun:test";

import { PrismaDispositionCallStore } from "../prisma-disposition-call-store";

const now = new Date("2026-07-18T12:00:00.000Z");
const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};

describe("canonical disposition persistence", () => {
  it("completes wrap-up and creates requested follow-up", async () => {
    let callUpdate: Record<string, unknown> | null = null;
    let taskCreate: Record<string, unknown> | null = null;
    const eventTypes: string[] = [];
    const transaction = {
      $queryRaw: async () => [],
      callCenterCall: {
        findFirst: async () => ({
          effectOwner: "CANONICAL",
          id: "call-1",
          number: { practicePhoneNumber: { locationId: "location-1" } },
          queueId: "queue-1",
          stateVersion: 7,
          status: "WRAP_UP",
        }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          callUpdate = data;
          return { stateVersion: 8 };
        },
      },
      callCenterEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          eventTypes.push(String(data.type));
          return { revision: BigInt(eventTypes.length) };
        },
      },
      callCenterQueue: {
        findFirst: async () => ({
          id: "queue-1",
          locations: [{ locationId: "location-1" }],
          maxWaitSec: 30,
          name: "Optical",
          ringTimeoutSec: 20,
        }),
      },
      callCenterTask: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          taskCreate = data;
          return data;
        },
        findMany: async () => [],
        updateMany: async () => ({ count: 0 }),
      },
    };
    const store = new PrismaDispositionCallStore((operation) =>
      operation(transaction as never),
    );

    const result = await store.transaction((current) =>
      current.saveDisposition(
        actor,
        {
          callId: "call-1",
          disposition: "FOLLOW_UP_REQUIRED",
          expectedStateVersion: 7,
          idempotencyKey: "disposition-1",
          note: "Call tomorrow",
          taskIds: [],
        },
        now,
      ),
    );

    expect(result).toMatchObject({ callId: "call-1", status: "CONFIRMED" });
    expect(callUpdate).toMatchObject({ status: "COMPLETED" });
    expect(taskCreate).toMatchObject({
      callId: "call-1",
      kind: "FOLLOW_UP",
      note: "Call tomorrow",
      status: "OPEN",
    });
    expect(eventTypes).toEqual(["TASK_CREATED", "CALL_DISPOSITION_SAVED"]);
  });
});
