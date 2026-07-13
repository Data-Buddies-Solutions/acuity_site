import { describe, expect, it } from "bun:test";

import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

import {
  CALL_CLAIM_REQUESTED_EVENT,
  claimCall,
  type ClaimCallInput,
  type ClaimCallTransaction,
} from "../claim-call";

const actor: QueueAccessActor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-1",
};
const input: ClaimCallInput = {
  callId: "call-1",
  clientInstanceId: "browser-1",
  expectedSessionStateVersion: 4,
  idempotencyKey: "operation-1",
};

function transaction() {
  const calls: string[] = [];
  const tx: ClaimCallTransaction = {
    appendReceipt: async (receipt, data, now) => {
      calls.push("receipt.append");
      return {
        actorUserId: receipt.actorUserId,
        aggregateId: receipt.aggregateId,
        aggregateType: receipt.aggregateType,
        data,
        occurredAt: now,
        revision: BigInt(12),
      };
    },
    createClaim: async (_actor, claimInput) => {
      calls.push("claim.create");
      return {
        agentSessionId: "session-1",
        callId: claimInput.callId,
        endpointId: "endpoint-1",
        legId: "leg-1",
        operationType: "CLAIM",
        providerCommandId: "command-1",
        status: "PENDING",
      };
    },
    findReceipt: async () => {
      calls.push("receipt.find");
      return null;
    },
    lockReceiptKey: async () => {
      calls.push("receipt.lock");
    },
  };
  return { calls, tx };
}

describe("canonical manual claim", () => {
  it("commits the provider intent before appending its replay receipt", async () => {
    const fake = transaction();
    const result = await claimCall(
      { transaction: (operation) => operation(fake.tx) },
      actor,
      input,
      new Date("2026-07-12T12:00:00.000Z"),
    );

    expect(fake.calls).toEqual([
      "receipt.lock",
      "receipt.find",
      "claim.create",
      "receipt.append",
    ]);
    expect(result).toEqual({
      agentSessionId: "session-1",
      callId: "call-1",
      endpointId: "endpoint-1",
      legId: "leg-1",
      occurredAt: "2026-07-12T12:00:00.000Z",
      operationType: "CLAIM",
      providerCommandId: "command-1",
      replayed: false,
      revision: "12",
      status: "PENDING",
    });
  });

  it("uses a dedicated operation type and keeps the session version out of the target", async () => {
    const fake = transaction();
    let receiptInput: Parameters<ClaimCallTransaction["appendReceipt"]>[0] | null = null;
    fake.tx.appendReceipt = async (receipt, data, now) => {
      receiptInput = receipt;
      return {
        actorUserId: receipt.actorUserId,
        aggregateId: receipt.aggregateId,
        aggregateType: receipt.aggregateType,
        data,
        occurredAt: now,
        revision: BigInt(13),
      };
    };

    await claimCall({ transaction: (operation) => operation(fake.tx) }, actor, {
      ...input,
      expectedSessionStateVersion: 99,
    });

    const captured = receiptInput as
      Parameters<ClaimCallTransaction["appendReceipt"]>[0] | null;
    expect(captured).toMatchObject({
      actorUserId: "user-1",
      type: CALL_CLAIM_REQUESTED_EVENT,
    });
    expect(captured?.targetFingerprint).not.toContain("99");
  });
});
