import { describe, expect, it } from "bun:test";

import type { Prisma } from "@/generated/prisma/client";
import {
  DirectHandoffReservationError,
  reserveDirectHandoff,
  type DirectHandoffDatabase,
} from "@/lib/call-center/infrastructure/prisma-direct-handoff-store";

const now = new Date("2026-07-13T20:00:00.000Z");
const expiresAt = new Date("2026-07-13T20:00:30.000Z");
const input = {
  callerPhone: "+17865550100",
  idempotencyKey: "key-1",
  practiceId: "practice-1",
  routePhoneNumber: "+19542872010",
  sourceCallId: "source-1",
};

function fixture() {
  const handoffs: Array<Record<string, unknown>> = [];
  const numberQueries: Array<Record<string, unknown>> = [];
  const number = {
    enabled: true,
    id: "number-1",
    inboundEnabled: true,
    inboundQueue: { enabled: true, id: "queue-1", practiceId: "practice-1" },
    inboundQueueId: "queue-1",
    practiceId: "practice-1",
    practicePhoneNumber: {
      phoneNumber: "+19542872010",
      practiceId: "practice-1",
    },
    practicePhoneNumberId: "phone-1",
  };
  const transaction = {
    $queryRaw: async () => [{ lock: "ok" }],
    callCenterHandoff: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, status: "ISSUED" };
        handoffs.push(row);
        return row;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        handoffs.filter(
          (row) =>
            row.sourceSystem === where.sourceSystem &&
            (row.sourceCallId === input.sourceCallId ||
              (row.practiceId === number.practiceId &&
                row.idempotencyKey === input.idempotencyKey)),
        ),
      update: async ({ data, where }: { data: object; where: { id: string } }) => {
        const row = handoffs.find(({ id }) => id === where.id);
        if (!row) throw new Error("missing handoff");
        Object.assign(row, data);
        return row;
      },
    },
    callCenterNumber: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        numberQueries.push(where);
        return [number];
      },
      findUniqueOrThrow: async () => number,
    },
  };
  return {
    database: {
      $transaction: async <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) =>
        operation(transaction as unknown as Prisma.TransactionClient),
    } satisfies DirectHandoffDatabase,
    handoffs,
    numberQueries,
  };
}

describe("Prisma direct handoff reservation", () => {
  it("creates one generic number-bound token reservation", async () => {
    const state = fixture();
    const result = await reserveDirectHandoff(
      input,
      { expiresAt, now, secret: "secret-1" },
      state.database,
    );

    expect(result.replayed).toBe(false);
    expect(state.numberQueries[0]).toMatchObject({ practiceId: "practice-1" });
    expect(result.sipHeaders["X-Acuity-Handoff-Token"]).toBeString();
    expect(state.handoffs[0]).toMatchObject({
      callerPhone: "+17865550100",
      numberId: "number-1",
      practiceId: "practice-1",
      queueId: "queue-1",
      sourceCallId: "source-1",
      sourceSystem: "ABITA",
      status: "ISSUED",
    });
    expect(state.handoffs[0]?.tokenHash).not.toBe(
      result.sipHeaders["X-Acuity-Handoff-Token"],
    );
  });

  it("replays the same live token without creating a second row", async () => {
    const state = fixture();
    const first = await reserveDirectHandoff(
      input,
      { expiresAt, now, secret: "secret-1" },
      state.database,
    );
    const replay = await reserveDirectHandoff(
      input,
      { expiresAt, now, secret: "secret-1" },
      state.database,
    );

    expect(replay).toEqual({ ...first, replayed: true });
    expect(state.handoffs).toHaveLength(1);
  });

  it("rejects changed input for an existing source call", async () => {
    const state = fixture();
    await reserveDirectHandoff(
      input,
      { expiresAt, now, secret: "secret-1" },
      state.database,
    );
    await expect(
      reserveDirectHandoff(
        { ...input, callerPhone: "+17865550101" },
        { expiresAt, now, secret: "secret-1" },
        state.database,
      ),
    ).rejects.toBeInstanceOf(DirectHandoffReservationError);
  });

  it("persists expiry before returning the terminal replay conflict", async () => {
    const state = fixture();
    await reserveDirectHandoff(
      input,
      { expiresAt, now, secret: "secret-1" },
      state.database,
    );
    await expect(
      reserveDirectHandoff(
        input,
        {
          expiresAt,
          now: new Date("2026-07-13T20:00:31.000Z"),
          secret: "secret-1",
        },
        state.database,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(state.handoffs[0]).toMatchObject({
      failureCode: "INGRESS_TIMEOUT",
      status: "EXPIRED",
    });
  });
});
