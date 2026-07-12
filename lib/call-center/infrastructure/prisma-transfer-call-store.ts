import { Prisma } from "@/generated/prisma/client";
import {
  TransferCallError,
  type TransferCallInput,
  type TransferCallStore,
  type TransferCallTransaction,
} from "@/lib/call-center/application/transfer-call";
import type {
  OperationReceiptData,
  OperationReceiptInput,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { resolveQueueAccess } from "@/lib/call-center/auth/queue-access";
import { PrismaOperationReceiptTransaction } from "@/lib/call-center/infrastructure/prisma-operation-receipts";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
export type TransferCallTransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

const liveAgentLegStatuses = [
  "CREATED",
  "DIALING",
  "RINGING",
  "ANSWERED",
  "BRIDGED",
] as const;

function record(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function operationStatus(
  status: "PENDING" | "SENDING" | "SENT" | "CONFIRMED" | "FAILED",
  nextAttemptAt: Date | null,
) {
  if (status === "SENDING" || (status === "FAILED" && nextAttemptAt)) {
    return "PENDING" as const;
  }
  return status;
}

class PrismaTransferCallTransaction implements TransferCallTransaction {
  private readonly receipts: PrismaOperationReceiptTransaction;

  constructor(private readonly transaction: Transaction) {
    this.receipts = new PrismaOperationReceiptTransaction(transaction);
  }

  appendReceipt(input: OperationReceiptInput, data: OperationReceiptData, now: Date) {
    return this.receipts.appendReceipt(input, data, now);
  }

  findReceipt(practiceId: string, type: string, idempotencyKey: string) {
    return this.receipts.findReceipt(practiceId, type, idempotencyKey);
  }

  lockReceiptKey(practiceId: string, type: string, idempotencyKey: string) {
    return this.receipts.lockReceiptKey(practiceId, type, idempotencyKey);
  }

  async createTransfer(actor: QueueAccessActor, input: TransferCallInput, now: Date) {
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${input.callId} FOR UPDATE`,
    );
    const call = await this.transaction.callCenterCall.findFirst({
      include: {
        number: { include: { practicePhoneNumber: true } },
        queue: {
          include: {
            locations: { select: { locationId: true } },
            members: {
              select: { userId: true },
              where: { enabled: true, role: "AGENT" },
            },
          },
        },
        winningLeg: { include: { agentSession: true } },
      },
      where: { id: input.callId, practiceId: actor.practiceId },
    });
    if (!call?.queue || !call.queueId) {
      throw new TransferCallError("Canonical call not found", 404);
    }
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_queue" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${call.queueId} FOR UPDATE`,
    );
    await resolveQueueAccess(actor, call.queueId, this.transaction);

    if (call.effectOwner !== "CANONICAL" || call.status !== "CONNECTED") {
      throw new TransferCallError("Only a connected canonical call can transfer", 409);
    }
    const sourceLeg = call.winningLeg;
    const sourceSession = sourceLeg?.agentSession;
    if (
      !sourceLeg ||
      sourceLeg.kind !== "AGENT" ||
      sourceLeg.status !== "BRIDGED" ||
      !sourceSession ||
      sourceSession.userId !== actor.userId ||
      sourceSession.currentCallId !== call.id
    ) {
      throw new TransferCallError("Source agent does not own the connected call", 403);
    }
    const competingTransfer = await this.transaction.callCenterCallLeg.findFirst({
      select: { id: true },
      where: {
        callId: call.id,
        commands: {
          some: {
            arguments: { equals: sourceLeg.id, path: ["replacesLegId"] },
            type: "DIAL_AGENT",
          },
        },
        endpointId: { not: input.targetEndpointId },
        kind: "AGENT",
        status: { in: [...liveAgentLegStatuses] },
      },
    });
    if (competingTransfer) {
      throw new TransferCallError("Another transfer is already in progress", 409);
    }

    const callLocationId = call.number.practicePhoneNumber.locationId;
    if (
      !actor.hasAllLocationAccess &&
      (!callLocationId || !actor.allowedLocationIds.includes(callLocationId))
    ) {
      throw new TransferCallError("Canonical call not found", 404);
    }

    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_endpoint" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${input.targetEndpointId} FOR UPDATE`,
    );
    const sessions = await this.transaction.callCenterAgentSession.findMany({
      include: { endpoint: true },
      orderBy: { id: "asc" },
      take: 2,
      where: {
        audioReady: true,
        connectionState: "READY",
        endpointId: input.targetEndpointId,
        leaseExpiresAt: { gt: now },
        microphoneReady: true,
        practiceId: actor.practiceId,
        presence: { in: ["AVAILABLE", "BUSY"] },
      },
    });
    if (sessions.length !== 1) {
      throw new TransferCallError("Transfer target is not uniquely ready", 409);
    }
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_agent_session" WHERE "id" = ${sessions[0]!.id} FOR UPDATE`,
    );
    const session = await this.transaction.callCenterAgentSession.findUnique({
      include: { endpoint: true },
      where: { id: sessions[0]!.id },
    });
    if (
      !session ||
      session.leaseExpiresAt <= now ||
      session.connectionState !== "READY" ||
      !session.microphoneReady ||
      !session.audioReady ||
      !session.endpoint.enabled ||
      !session.endpoint.providerCredentialId ||
      !session.endpoint.sipUsername ||
      session.endpointId === sourceLeg.endpointId
    ) {
      throw new TransferCallError("Transfer target is not ready", 409);
    }
    if (!call.queue.members.some(({ userId }) => userId === session.userId)) {
      throw new TransferCallError("Transfer target is not an eligible queue agent", 409);
    }

    const queueLocationIds = new Set(
      call.queue.locations.map(({ locationId }) => locationId),
    );
    if (
      queueLocationIds.size > 0 &&
      (!session.endpoint.locationId ||
        !queueLocationIds.has(session.endpoint.locationId) ||
        !callLocationId ||
        !queueLocationIds.has(callLocationId))
    ) {
      throw new TransferCallError("Transfer target is outside the call scope", 409);
    }
    const membership = await this.transaction.practiceMembership.findUnique({
      select: {
        locationScope: true,
        locations: {
          select: { locationId: true },
          where: { location: { practiceId: actor.practiceId } },
        },
      },
      where: {
        practiceId_userId: {
          practiceId: actor.practiceId,
          userId: session.userId,
        },
      },
    });
    const targetLocationIds = new Set(
      membership?.locations.map(({ locationId }) => locationId) ?? [],
    );
    if (
      !membership ||
      (membership.locationScope === "SELECTED" &&
        (!session.endpoint.locationId ||
          !targetLocationIds.has(session.endpoint.locationId) ||
          !callLocationId ||
          !targetLocationIds.has(callLocationId)))
    ) {
      throw new TransferCallError("Transfer target is outside its location scope", 409);
    }

    const existing = await this.transaction.callCenterCallLeg.findFirst({
      include: {
        commands: {
          orderBy: { createdAt: "desc" },
          take: 1,
          where: { type: "DIAL_AGENT" },
        },
      },
      orderBy: [{ attemptNumber: "desc" }, { id: "desc" }],
      where: {
        agentSessionId: session.id,
        callId: call.id,
        endpointId: session.endpointId,
        kind: "AGENT",
        status: { in: [...liveAgentLegStatuses] },
      },
    });
    const existingCommand = existing?.commands[0];
    if (existing && existingCommand) {
      const argumentsRecord = record(existingCommand.arguments);
      if (
        argumentsRecord?.replacesLegId === sourceLeg.id &&
        ((session.offeredCallId === call.id &&
          session.currentCallId === null &&
          session.presence === "AVAILABLE") ||
          (session.offeredCallId === null &&
            session.currentCallId === call.id &&
            session.presence === "BUSY"))
      ) {
        return {
          callId: call.id,
          operationType: "TRANSFER",
          providerCommandId: existingCommand.id,
          sourceLegId: sourceLeg.id,
          stateVersion: call.stateVersion,
          status: operationStatus(existingCommand.status, existingCommand.nextAttemptAt),
          targetAgentSessionId: session.id,
          targetEndpointId: session.endpointId,
          targetLegId: existing.id,
        };
      }
      throw new TransferCallError("Transfer target is already occupied", 409);
    }
    if (
      session.presence !== "AVAILABLE" ||
      session.currentCallId ||
      session.offeredCallId
    ) {
      throw new TransferCallError("Transfer target is already occupied", 409);
    }

    const reserved = await this.transaction.callCenterAgentSession.updateMany({
      data: {
        offeredCallId: call.id,
        readyAt: null,
        stateVersion: { increment: 1 },
      },
      where: {
        audioReady: true,
        connectionState: "READY",
        currentCallId: null,
        offeredCallId: null,
        endpointId: session.endpointId,
        id: session.id,
        leaseExpiresAt: { gt: now },
        microphoneReady: true,
        presence: "AVAILABLE",
        stateVersion: session.stateVersion,
      },
    });
    if (reserved.count !== 1) {
      throw new TransferCallError("Transfer target changed; refresh and try again", 409);
    }

    const attemptNumber =
      (await this.transaction.callCenterCallLeg.count({
        where: { callId: call.id, kind: "AGENT" },
      })) + 1;
    const leg = await this.transaction.callCenterCallLeg.create({
      data: {
        agentSessionId: session.id,
        attemptNumber,
        callId: call.id,
        endpointId: session.endpointId,
        kind: "AGENT",
        startedAt: now,
        status: "CREATED",
      },
      select: { id: true },
    });
    const command = await this.transaction.callCenterCommand.create({
      data: {
        arguments: {
          agentSessionId: session.id,
          endpointId: session.endpointId,
          replacesLegId: sourceLeg.id,
        },
        callId: call.id,
        idempotencyKey: `transfer:${sourceLeg.id}:${leg.id}`,
        legId: leg.id,
        practiceId: call.practiceId,
        type: "DIAL_AGENT",
      },
      select: { id: true },
    });
    const updatedCall = await this.transaction.callCenterCall.update({
      data: {
        deadlineAt: new Date(now.getTime() + call.queue.ringTimeoutSec * 1_000),
        stateVersion: { increment: 1 },
      },
      select: { stateVersion: true },
      where: { id: call.id },
    });
    await this.transaction.callCenterEvent.create({
      data: {
        actorUserId: actor.userId,
        aggregateId: session.id,
        aggregateType: "AGENT_SESSION",
        data: {
          callId: call.id,
          presence: "AVAILABLE",
          replacesLegId: sourceLeg.id,
          stateVersion: session.stateVersion + 1,
        },
        idempotencyKey: `transfer-session:${leg.id}`,
        occurredAt: now,
        practiceId: call.practiceId,
        type: "AGENT_SESSION_CALL_OFFERED",
      },
    });

    return {
      callId: call.id,
      operationType: "TRANSFER",
      providerCommandId: command.id,
      sourceLegId: sourceLeg.id,
      stateVersion: updatedCall.stateVersion,
      status: "PENDING",
      targetAgentSessionId: session.id,
      targetEndpointId: session.endpointId,
      targetLegId: leg.id,
    };
  }
}

export class PrismaTransferCallStore implements TransferCallStore {
  constructor(
    private readonly runTransaction: TransferCallTransactionRunner = (operation) =>
      prisma.$transaction(operation),
  ) {}

  transaction<T>(operation: (transaction: TransferCallTransaction) => Promise<T>) {
    return this.runTransaction((transaction) =>
      operation(new PrismaTransferCallTransaction(transaction)),
    );
  }
}

export const prismaTransferCallStore = new PrismaTransferCallStore();
