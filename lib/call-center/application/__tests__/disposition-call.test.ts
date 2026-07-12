import { describe, expect, it } from "bun:test";
import { dispositionCall, type DispositionCallTransaction } from "../disposition-call";

const actor = {
  allowedLocationIds: [],
  hasAllLocationAccess: true,
  practiceId: "practice-1",
  userId: "user-1",
};
const input = {
  callId: "call-1",
  disposition: "RESOLVED" as const,
  expectedStateVersion: 3,
  idempotencyKey: "key-1",
  note: null,
  taskIds: ["task-1"],
};

describe("canonical disposition", () => {
  it("replays one exact operation without applying disposition twice", async () => {
    let saved = 0;
    let event: Awaited<ReturnType<DispositionCallTransaction["findReceipt"]>> = null;
    const transaction: DispositionCallTransaction = {
      appendReceipt: async (receipt, data, now) =>
        (event = {
          aggregateId: receipt.aggregateId,
          aggregateType: receipt.aggregateType,
          actorUserId: receipt.actorUserId,
          data,
          occurredAt: now,
          revision: BigInt(20),
        }),
      findReceipt: async () => event,
      lockReceiptKey: async () => {},
      saveDisposition: async () => {
        saved += 1;
        return {
          callId: "call-1",
          operationType: "DISPOSITION",
          resolvedTaskCount: 1,
          stateVersion: 4,
          status: "CONFIRMED",
        };
      },
    };
    const store = {
      transaction: async <T>(operation: (tx: DispositionCallTransaction) => Promise<T>) =>
        operation(transaction),
    };
    const first = await dispositionCall(store, actor, input);
    const replay = await dispositionCall(store, actor, input);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(saved).toBe(1);
  });
});
