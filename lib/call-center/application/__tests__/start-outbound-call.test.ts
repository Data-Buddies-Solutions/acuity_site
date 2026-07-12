import { describe, expect, it } from "bun:test";

import type {
  OperationReceiptData,
  OperationReceiptEvent,
  OperationReceiptInput,
} from "@/lib/call-center/application/operation-receipts";
import {
  CALL_OUTBOUND_REQUESTED_EVENT,
  startOutboundCall,
  type StartOutboundCallInput,
  type StartOutboundCallTransaction,
} from "@/lib/call-center/application/start-outbound-call";

const actor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const input: StartOutboundCallInput = {
  clientInstanceId: "browser-1",
  destination: "+15555550123",
  endpointId: "endpoint-1",
  expectedSessionStateVersion: 3,
  idempotencyKey: "operation-1",
  numberId: "number-1",
  queueId: "queue-1",
};

function fakeTransaction() {
  let receipt: OperationReceiptEvent | null = null;
  let creates = 0;
  const transaction: StartOutboundCallTransaction = {
    async appendReceipt(operation: OperationReceiptInput, data, now) {
      receipt = {
        actorUserId: operation.actorUserId,
        aggregateId: operation.aggregateId,
        aggregateType: operation.aggregateType,
        data,
        occurredAt: now,
        revision: BigInt(7),
      };
      return receipt;
    },
    async createOutboundCall() {
      creates += 1;
      return {
        aggregateId: "call-1",
        data: {
          agentSessionId: "session-1",
          callId: "call-1",
          clientState: "opaque",
          endpointId: "endpoint-1",
          from: "+15555550000",
          legId: "leg-1",
          operationType: "OUTBOUND",
          stateVersion: 0,
          status: "CONFIRMED",
          to: "+15555550123",
        } satisfies OperationReceiptData,
      };
    },
    async findReceipt() {
      return receipt;
    },
    async lockReceiptKey() {},
  };
  return {
    creates: () => creates,
    store: {
      transaction: <T>(
        operation: (current: StartOutboundCallTransaction) => Promise<T>,
      ) => operation(transaction),
    },
  };
}

describe("canonical outbound call", () => {
  it("creates one durable intent and replays its exact dial data", async () => {
    const fake = fakeTransaction();

    const first = await startOutboundCall(fake.store, actor, input);
    const replay = await startOutboundCall(fake.store, actor, input);

    expect(first).toMatchObject({
      callId: "call-1",
      clientState: "opaque",
      operationType: "OUTBOUND",
      replayed: false,
      status: "CONFIRMED",
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(fake.creates()).toBe(1);
  });

  it("rejects reuse of the key for a different destination", async () => {
    const fake = fakeTransaction();
    await startOutboundCall(fake.store, actor, input);

    await expect(
      startOutboundCall(fake.store, actor, {
        ...input,
        destination: "+15555550999",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fake.creates()).toBe(1);
  });

  it("uses the outbound operation event as its receipt boundary", async () => {
    const fake = fakeTransaction();
    const receipt = await startOutboundCall(fake.store, actor, input);
    expect(receipt.revision).toBe("7");
    expect(CALL_OUTBOUND_REQUESTED_EVENT).toBe("CALL_OUTBOUND_REQUESTED");
  });
});
