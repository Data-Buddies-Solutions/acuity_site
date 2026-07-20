import { describe, expect, it } from "bun:test";

import {
  PrismaSetCallHoldMusicStore,
  PrismaSetCallHoldMusicTransaction,
} from "@/lib/call-center/infrastructure/prisma-set-call-hold-music-store";

const actor = {
  allowedLocationIds: [],
  hasAllLocationAccess: true,
  practiceId: "practice-1",
  userId: "user-1",
};

describe("Prisma hold music store", () => {
  it("reads settlement through its injected command boundary", async () => {
    let reads = 0;
    const store = new PrismaSetCallHoldMusicStore(
      async () => {
        throw new Error("transaction should not run");
      },
      {
        findUnique: async () => {
          reads += 1;
          return { status: "CONFIRMED" };
        },
      } as never,
    );

    await expect(store.waitForCommandSettlement("command-1")).resolves.toBe("CONFIRMED");
    expect(reads).toBe(1);
  });

  for (const latestType of ["START_HOLD_MUSIC", "STOP_HOLD_MUSIC"] as const) {
    it(`lets stop supersede an uncertain in-flight ${latestType}`, async () => {
      let created: Record<string, unknown> | null = null;
      let superseded: Record<string, unknown> | null = null;
      const transaction = {
        $queryRaw: async () => [{ id: "call-1" }],
        callCenterCall: {
          findFirst: async () => ({
            direction: "INBOUND",
            id: "call-1",
            legs: [
              {
                agentSession: { userId: "user-1" },
                endpoint: { locationId: "location-1", userId: "user-1" },
                id: "leg-1",
                kind: "AGENT",
                providerCallControlId: "control-1",
                status: "BRIDGED",
              },
            ],
            number: { practicePhoneNumber: { locationId: "location-1" } },
            practiceId: "practice-1",
            queueId: null,
            stateVersion: 4,
            status: "CONNECTED",
            winningLegId: "leg-1",
          }),
        },
        callCenterCommand: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            created = data;
            return { id: "stop-command" };
          },
          findFirst: async () => ({
            id: "start-command",
            status: "SENDING",
            type: latestType,
          }),
          updateMany: async (input: Record<string, unknown>) => {
            superseded = input;
            return { count: 1 };
          },
        },
      };

      await new PrismaSetCallHoldMusicTransaction(
        transaction as never,
      ).createHoldMusicCommand(
        actor,
        {
          action: "STOP",
          callId: "call-1",
          expectedStateVersion: 4,
          idempotencyKey: "resume-1",
        },
        new Date("2026-07-19T12:00:00.000Z"),
      );

      expect(created).toMatchObject({ type: "STOP_HOLD_MUSIC" });
      expect(created).toHaveProperty("dependsOnCommandId", null);
      expect(superseded).toMatchObject({
        data: { errorCode: "COMMAND_SUPERSEDED", status: "FAILED" },
        where: { id: "start-command", status: "SENDING" },
      });
    });
  }

  it("does not make stop depend on an earlier confirmed start", async () => {
    let created: Record<string, unknown> | null = null;
    const transaction = {
      $queryRaw: async () => [{ id: "call-1" }],
      callCenterCall: {
        findFirst: async () => ({
          direction: "INBOUND",
          id: "call-1",
          legs: [
            {
              agentSession: { userId: "user-1" },
              endpoint: { locationId: "location-1", userId: "user-1" },
              id: "leg-1",
              kind: "AGENT",
              providerCallControlId: "control-1",
              status: "BRIDGED",
            },
          ],
          number: { practicePhoneNumber: { locationId: "location-1" } },
          practiceId: "practice-1",
          queueId: null,
          stateVersion: 4,
          status: "CONNECTED",
          winningLegId: "leg-1",
        }),
      },
      callCenterCommand: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created = data;
          return { id: "stop-command" };
        },
        findFirst: async () => ({
          id: "start-command",
          status: "CONFIRMED",
          type: "START_HOLD_MUSIC",
        }),
        updateMany: async () => ({ count: 0 }),
      },
    };

    await new PrismaSetCallHoldMusicTransaction(
      transaction as never,
    ).createHoldMusicCommand(
      actor,
      {
        action: "STOP",
        callId: "call-1",
        expectedStateVersion: 4,
        idempotencyKey: "resume-confirmed",
      },
      new Date("2026-07-19T12:00:00.000Z"),
    );

    expect(created).toMatchObject({
      dependsOnCommandId: null,
      type: "STOP_HOLD_MUSIC",
    });
  });
});
