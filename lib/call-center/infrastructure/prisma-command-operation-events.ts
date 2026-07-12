import type { Prisma } from "@/generated/prisma/client";
import { CALL_CLAIM_REQUESTED_EVENT } from "@/lib/call-center/application/claim-call";
import { CALL_TRANSFER_REQUESTED_EVENT } from "@/lib/call-center/application/transfer-call";

export const CALL_OPERATION_STATUS_CHANGED_EVENT = "CALL_OPERATION_STATUS_CHANGED";

type Transaction = Prisma.TransactionClient;

/** Appends convergent UI events for every accepted operation bound to this command. */
export async function appendCommandOperationStatus(
  transaction: Transaction,
  input: {
    attemptCount: number;
    commandId: string;
    now: Date;
    status: "CONFIRMED" | "FAILED" | "PENDING" | "SENT";
  },
) {
  const command = await transaction.callCenterCommand.findUnique({
    select: { callId: true, practiceId: true, type: true },
    where: { id: input.commandId },
  });
  if (!command || command.type !== "DIAL_AGENT") return null;

  const receipts = await transaction.callCenterEvent.findMany({
    orderBy: { revision: "asc" },
    select: { actorUserId: true, data: true, revision: true, type: true },
    where: {
      aggregateId: command.callId,
      aggregateType: "CALL",
      data: { path: ["providerCommandId"], equals: input.commandId },
      practiceId: command.practiceId,
      type: { in: [CALL_CLAIM_REQUESTED_EVENT, CALL_TRANSFER_REQUESTED_EVENT] },
    },
  });
  if (receipts.length === 0) return [];

  return Promise.all(
    receipts.map((receipt) =>
      transaction.callCenterEvent.create({
        data: {
          actorUserId: receipt.actorUserId,
          aggregateId: command.callId,
          aggregateType: "CALL",
          data: {
            operationEventRevision: receipt.revision.toString(),
            operationType:
              receipt.type === CALL_TRANSFER_REQUESTED_EVENT ? "TRANSFER" : "CLAIM",
            providerCommandId: input.commandId,
            ...(receipt.data &&
            typeof receipt.data === "object" &&
            !Array.isArray(receipt.data)
              ? {
                  ...(receipt.type === CALL_TRANSFER_REQUESTED_EVENT
                    ? { sourceLegId: receipt.data.sourceLegId }
                    : {}),
                  targetAgentSessionId:
                    receipt.type === CALL_TRANSFER_REQUESTED_EVENT
                      ? receipt.data.targetAgentSessionId
                      : receipt.data.agentSessionId,
                  targetEndpointId:
                    receipt.type === CALL_TRANSFER_REQUESTED_EVENT
                      ? receipt.data.targetEndpointId
                      : receipt.data.endpointId,
                  targetLegId:
                    receipt.type === CALL_TRANSFER_REQUESTED_EVENT
                      ? receipt.data.targetLegId
                      : receipt.data.legId,
                }
              : {}),
            status: input.status,
          },
          idempotencyKey: `${input.commandId}:${receipt.revision}:${input.status}:${input.attemptCount}`,
          occurredAt: input.now,
          practiceId: command.practiceId,
          type: CALL_OPERATION_STATUS_CHANGED_EVENT,
        },
      }),
    ),
  );
}
