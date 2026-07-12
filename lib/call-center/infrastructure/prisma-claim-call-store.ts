import { Prisma } from "@/generated/prisma/client";
import {
  ClaimCallError,
  type ClaimCallInput,
  type ClaimCallStore,
  type ClaimCallTransaction,
} from "@/lib/call-center/application/claim-call";
import type {
  OperationReceiptData,
  OperationReceiptInput,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { resolveQueueAccess } from "@/lib/call-center/auth/queue-access";
import { PrismaOperationReceiptTransaction } from "@/lib/call-center/infrastructure/prisma-operation-receipts";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
export type ClaimCallTransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

const liveAgentLegStatuses = [
  "CREATED",
  "DIALING",
  "RINGING",
  "ANSWERED",
  "BRIDGED",
] as const;

function operationStatus(
  status: "PENDING" | "SENDING" | "SENT" | "CONFIRMED" | "FAILED",
  nextAttemptAt: Date | null,
) {
  if (status === "SENDING") return "PENDING";
  if (status === "FAILED" && nextAttemptAt) return "PENDING";
  return status;
}

class PrismaClaimCallTransaction implements ClaimCallTransaction {
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

  async createClaim(actor: QueueAccessActor, input: ClaimCallInput, now: Date) {
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${input.callId} FOR UPDATE`,
    );
    const call = await this.transaction.callCenterCall.findFirst({
      include: {
        number: {
          select: { practicePhoneNumber: { select: { locationId: true } } },
        },
        queue: { select: { id: true } },
      },
      where: { id: input.callId, practiceId: actor.practiceId },
    });
    if (!call?.queueId || !call.queue) {
      throw new ClaimCallError("Canonical call not found", 404);
    }

    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_queue" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${call.queueId} FOR UPDATE`,
    );
    const lockedQueue = await this.transaction.callCenterQueue.findUnique({
      include: {
        locations: { select: { locationId: true } },
        members: {
          select: { id: true },
          where: { enabled: true, role: "AGENT", userId: actor.userId },
        },
      },
      where: { id: call.queueId },
    });
    if (!lockedQueue) {
      throw new ClaimCallError("Canonical call not found", 404);
    }

    await resolveQueueAccess(actor, call.queueId, this.transaction);
    const callLocationId = call.number.practicePhoneNumber.locationId;
    if (
      !actor.hasAllLocationAccess &&
      (!callLocationId || !actor.allowedLocationIds.includes(callLocationId))
    ) {
      throw new ClaimCallError("Canonical call not found", 404);
    }
    if (lockedQueue.members.length !== 1) {
      throw new ClaimCallError("Agent queue membership is required", 403);
    }
    if (lockedQueue?.routingMode !== "ACTIVE") {
      throw new ClaimCallError("Canonical routing is not active for this queue", 409);
    }
    if (call.direction !== "INBOUND") {
      throw new ClaimCallError("Only inbound calls can be claimed", 409);
    }

    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_endpoint" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${input.endpointId} FOR UPDATE`,
    );
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_agent_session" WHERE "practiceId" = ${actor.practiceId} AND "userId" = ${actor.userId} AND "endpointId" = ${input.endpointId} AND "browserSessionId" = ${input.clientInstanceId} FOR UPDATE`,
    );
    const session = await this.transaction.callCenterAgentSession.findFirst({
      include: { endpoint: true },
      where: {
        browserSessionId: input.clientInstanceId,
        endpointId: input.endpointId,
        practiceId: actor.practiceId,
        userId: actor.userId,
      },
    });
    if (!session) {
      throw new ClaimCallError("Canonical agent session is unavailable", 409);
    }
    if (
      session.leaseExpiresAt <= now ||
      session.connectionState !== "READY" ||
      !session.microphoneReady ||
      !session.audioReady
    ) {
      throw new ClaimCallError("Agent session is not ready to claim calls", 409);
    }
    if (
      !session.endpoint.enabled ||
      !session.endpoint.providerCredentialId ||
      !session.endpoint.sipUsername
    ) {
      throw new ClaimCallError("Call center endpoint is not configured", 409);
    }
    const queueLocationIds = new Set(
      lockedQueue.locations.map(({ locationId }) => locationId),
    );
    if (
      queueLocationIds.size > 0 &&
      (!session.endpoint.locationId || !queueLocationIds.has(session.endpoint.locationId))
    ) {
      throw new ClaimCallError("Endpoint is not eligible for this queue", 409);
    }
    if (
      !actor.hasAllLocationAccess &&
      (!session.endpoint.locationId ||
        !actor.allowedLocationIds.includes(session.endpoint.locationId))
    ) {
      throw new ClaimCallError("Endpoint is not eligible for this user", 403);
    }
    if (call.status !== "QUEUED" && call.status !== "RINGING") {
      throw new ClaimCallError("Call is no longer available to claim", 409);
    }
    if (call.winningLegId) {
      throw new ClaimCallError("Call was already answered", 409);
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
    if (existing && !existingCommand) {
      throw new ClaimCallError("Existing claim is missing its provider command", 409);
    }
    if (existing && existingCommand) {
      if (
        session.stateVersion !== input.expectedSessionStateVersion ||
        session.currentCallId !== call.id ||
        session.presence !== "BUSY"
      ) {
        throw new ClaimCallError("Existing claim session is inconsistent", 409);
      }
      return {
        callId: call.id,
        legId: existing.id,
        operationType: "CLAIM",
        providerCommandId: existingCommand.id,
        stateVersion: call.stateVersion,
        status: operationStatus(existingCommand.status, existingCommand.nextAttemptAt),
      };
    }

    if (session.stateVersion !== input.expectedSessionStateVersion) {
      throw new ClaimCallError("Agent session changed; refresh and try again", 409);
    }
    if (session.presence !== "AVAILABLE" || session.currentCallId) {
      throw new ClaimCallError("Agent session is not ready to claim calls", 409);
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
          purpose: "CLAIM",
        },
        callId: call.id,
        idempotencyKey: `dial:${leg.id}`,
        legId: leg.id,
        practiceId: call.practiceId,
        type: "DIAL_AGENT",
      },
      select: { id: true },
    });
    const updatedSession = await this.transaction.callCenterAgentSession.update({
      data: {
        currentCallId: call.id,
        presence: "BUSY",
        stateVersion: { increment: 1 },
      },
      select: { stateVersion: true },
      where: { id: session.id },
    });
    const updatedCall = await this.transaction.callCenterCall.update({
      data: {
        stateVersion: { increment: 1 },
      },
      select: { stateVersion: true },
      where: { id: call.id },
    });

    await this.transaction.callCenterEvent.create({
      data: {
        actorUserId: actor.userId,
        aggregateId: call.id,
        aggregateType: "CALL",
        data: { commandId: command.id, legId: leg.id, status: call.status },
        idempotencyKey: `claim-state:${leg.id}`,
        occurredAt: now,
        practiceId: call.practiceId,
        type: "CALL_CLAIM_STARTED",
      },
    });
    await this.transaction.callCenterEvent.create({
      data: {
        actorUserId: actor.userId,
        aggregateId: session.id,
        aggregateType: "AGENT_SESSION",
        data: {
          callId: call.id,
          presence: "BUSY",
          stateVersion: updatedSession.stateVersion,
        },
        idempotencyKey: `claim-session:${leg.id}`,
        occurredAt: now,
        practiceId: call.practiceId,
        type: "AGENT_SESSION_BUSY",
      },
    });

    return {
      callId: call.id,
      legId: leg.id,
      operationType: "CLAIM",
      providerCommandId: command.id,
      stateVersion: updatedCall.stateVersion,
      status: "PENDING",
    };
  }
}

export class PrismaClaimCallStore implements ClaimCallStore {
  constructor(
    private readonly runTransaction: ClaimCallTransactionRunner = (operation) =>
      prisma.$transaction(operation),
  ) {}

  transaction<T>(operation: (transaction: ClaimCallTransaction) => Promise<T>) {
    return this.runTransaction((transaction) =>
      operation(new PrismaClaimCallTransaction(transaction)),
    );
  }
}

export const prismaClaimCallStore = new PrismaClaimCallStore();
