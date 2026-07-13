import { describe, expect, it } from "bun:test";

import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

import {
  CALL_TRANSFER_REQUESTED_EVENT,
  transferCall,
  type TransferCallTransaction,
} from "../transfer-call";

const actor: QueueAccessActor = {
  allowedLocationIds: ["location-1"],
  hasAllLocationAccess: false,
  practiceId: "practice-1",
  userId: "user-source",
};

describe("canonical transfer operation", () => {
  it("persists provider intent before its replay receipt", async () => {
    const calls: string[] = [];
    const transaction: TransferCallTransaction = {
      appendReceipt: async (input, data, now) => {
        calls.push("receipt.append");
        return {
          actorUserId: input.actorUserId,
          aggregateId: input.aggregateId,
          aggregateType: input.aggregateType,
          data,
          occurredAt: now,
          revision: BigInt(30),
        };
      },
      createTransfer: async () => {
        calls.push("transfer.create");
        return {
          callId: "call-1",
          operationType: "TRANSFER",
          providerCommandId: "command-1",
          sourceLegId: "source-leg-1",
          stateVersion: 8,
          status: "PENDING",
          targetAgentSessionId: "target-session-1",
          targetEndpointId: "target-endpoint-1",
          targetLegId: "target-leg-1",
          targetUserId: "target-user-1",
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

    const result = await transferCall(
      { transaction: (operation) => operation(transaction) },
      actor,
      {
        callId: "call-1",
        idempotencyKey: "transfer-1",
        targetUserId: "target-user-1",
      },
      new Date("2026-07-12T12:00:00.000Z"),
    );

    expect(calls).toEqual([
      "receipt.lock",
      "receipt.find",
      "transfer.create",
      "receipt.append",
    ]);
    expect(result).toMatchObject({
      operationType: "TRANSFER",
      providerCommandId: "command-1",
      revision: "30",
      targetEndpointId: "target-endpoint-1",
    });
  });

  it("owns a dedicated event and target fingerprint", async () => {
    let eventType = "";
    let fingerprint = "";
    const transaction = {
      appendReceipt: async (input: { targetFingerprint: string; type: string }) => {
        eventType = input.type;
        fingerprint = input.targetFingerprint;
        return {
          actorUserId: actor.userId,
          aggregateId: "call-1",
          aggregateType: "CALL" as const,
          data: {},
          occurredAt: new Date(),
          revision: BigInt(1),
        };
      },
      createTransfer: async () => ({}),
      findReceipt: async () => null,
      lockReceiptKey: async () => {},
    } as unknown as TransferCallTransaction;
    await transferCall({ transaction: (operation) => operation(transaction) }, actor, {
      callId: "call-1",
      idempotencyKey: "transfer-1",
      targetUserId: "user-1",
    });
    expect(eventType).toBe(CALL_TRANSFER_REQUESTED_EVENT);
    expect(fingerprint).toContain("user-1");
  });
});
