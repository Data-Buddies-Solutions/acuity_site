import { describe, expect, it } from "bun:test";

import {
  SetCallHoldMusicError,
  setCallHoldMusic,
  type SetCallHoldMusicStore,
  type SetCallHoldMusicTransaction,
} from "@/lib/call-center/application/set-call-hold-music";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const now = new Date("2026-07-19T12:00:00.000Z");

function store(): SetCallHoldMusicStore {
  const transaction: SetCallHoldMusicTransaction = {
    appendReceipt: async (input, data, occurredAt) => ({
      actorUserId: input.actorUserId,
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      data,
      occurredAt,
      revision: BigInt(7),
    }),
    createHoldMusicCommand: async (_actor, input) => ({
      action: input.action,
      callId: input.callId,
      commandId: "command-1",
      operationType: "HOLD_MUSIC",
      status: "QUEUED",
    }),
    findReceipt: async () => null,
    lockReceiptKey: async () => {},
  };
  return {
    transaction: async (operation) => operation(transaction),
    waitForCommandSettlement: async () => "CONFIRMED",
  };
}

describe("set call hold music", () => {
  it("persists before dispatching and returns a confirmed receipt", async () => {
    const dispatched: string[] = [];
    const receipt = await setCallHoldMusic(
      store(),
      async (commandId) => {
        dispatched.push(commandId);
        return {
          commandId,
          markSent: "MARKED",
          status: "DISPATCHED",
        };
      },
      actor,
      {
        action: "START",
        callId: "call-1",
        idempotencyKey: "hold-1",
      },
      now,
    );

    expect(dispatched).toEqual(["command-1"]);
    expect(receipt).toMatchObject({
      action: "START",
      callId: "call-1",
      commandId: "command-1",
      occurredAt: now.toISOString(),
      operationType: "HOLD_MUSIC",
      replayed: false,
      revision: "7",
      status: "CONFIRMED",
    });
  });

  it("keeps the caller held when provider dispatch is not accepted", async () => {
    await expect(
      setCallHoldMusic(
        store(),
        async () => ({ status: "NOT_CLAIMED" }),
        actor,
        {
          action: "STOP",
          callId: "call-1",
          idempotencyKey: "resume-1",
        },
        now,
      ),
    ).rejects.toBeInstanceOf(SetCallHoldMusicError);
  });

  it("rejects a start that Telnyx asynchronously reports as failed", async () => {
    const failedStore = store();
    failedStore.waitForCommandSettlement = async () => "FAILED";

    await expect(
      setCallHoldMusic(
        failedStore,
        async (commandId) => ({
          commandId,
          markSent: "MARKED",
          status: "DISPATCHED",
        }),
        actor,
        {
          action: "START",
          callId: "call-1",
          idempotencyKey: "hold-failed-1",
        },
        now,
      ),
    ).rejects.toBeInstanceOf(SetCallHoldMusicError);
  });

  it("resumes after the durable stop dispatch without waiting for a callback", async () => {
    const stopStore = store();
    let waitedForSettlement = false;
    stopStore.waitForCommandSettlement = async () => {
      waitedForSettlement = true;
      return "CONFIRMED";
    };

    await expect(
      setCallHoldMusic(
        stopStore,
        async (commandId) => ({
          commandId,
          markSent: "MARKED",
          status: "DISPATCHED",
        }),
        actor,
        {
          action: "STOP",
          callId: "call-1",
          idempotencyKey: "resume-timeout-1",
        },
        now,
      ),
    ).resolves.toMatchObject({ status: "DISPATCHED" });
    expect(waitedForSettlement).toBe(false);
  });

  it("does not claim a stop is confirmed when dispatch already found it sent", async () => {
    await expect(
      setCallHoldMusic(
        store(),
        async (commandId) => ({
          commandId,
          markSent: "ALREADY_MARKED",
          status: "SETTLED",
        }),
        actor,
        {
          action: "STOP",
          callId: "call-1",
          idempotencyKey: "resume-settled-1",
        },
        now,
      ),
    ).resolves.toMatchObject({ status: "DISPATCHED" });
  });
});
