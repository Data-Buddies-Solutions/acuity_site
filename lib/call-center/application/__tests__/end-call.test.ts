import { describe, expect, it } from "bun:test";

import {
  endCall,
  type EndCallInput,
  type EndCallTransaction,
} from "@/lib/call-center/application/end-call";
import type {
  OperationReceiptEvent,
  OperationReceiptInput,
} from "@/lib/call-center/application/operation-receipts";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const input: EndCallInput = {
  callId: "call-1",
  clientInstanceId: "browser-1",
  idempotencyKey: "end-1",
};

function fakeStore() {
  let receipt: OperationReceiptEvent | null = null;
  let transitions = 0;
  const transaction: EndCallTransaction = {
    async appendReceipt(operation: OperationReceiptInput, data, now) {
      receipt = {
        actorUserId: operation.actorUserId,
        aggregateId: operation.aggregateId,
        aggregateType: operation.aggregateType,
        data,
        occurredAt: now,
        revision: BigInt(12),
      };
      return receipt;
    },
    async endCall() {
      transitions += 1;
      return {
        callId: "call-1",
        commandIdsJson: '["hangup-agent","hangup-customer"]',
        status: "COMPLETED",
      };
    },
    async findReceipt() {
      return receipt;
    },
    async lockReceiptKey() {},
  };
  return {
    transitions: () => transitions,
    transaction: <T>(operation: (current: EndCallTransaction) => Promise<T>) =>
      operation(transaction),
  };
}

describe("canonical end call", () => {
  it("performs one durable transition and replays its exact cleanup commands", async () => {
    const store = fakeStore();

    const first = await endCall(store, actor, input);
    const replay = await endCall(store, actor, input);

    expect(first).toMatchObject({
      callId: "call-1",
      commandIdsJson: '["hangup-agent","hangup-customer"]',
      replayed: false,
      status: "COMPLETED",
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(store.transitions()).toBe(1);
  });

  it("rejects reusing an end key from another browser instance", async () => {
    const store = fakeStore();
    await endCall(store, actor, input);

    await expect(
      endCall(store, actor, { ...input, clientInstanceId: "browser-2" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(store.transitions()).toBe(1);
  });
});
