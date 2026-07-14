import { Prisma } from "@/generated/prisma/client";
import {
  CALL_CLAIMED_EVENT,
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
import { releaseAgentSessionReservation } from "@/lib/call-center/infrastructure/prisma-agent-session-reservation";
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

function claimOwner(data: Prisma.JsonValue) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as Record<string, Prisma.JsonValue>;
  if (
    typeof value.agentSessionId !== "string" ||
    typeof value.endpointId !== "string" ||
    typeof value.legId !== "string" ||
    typeof value.providerCommandId !== "string"
  ) {
    return null;
  }
  return {
    agentSessionId: value.agentSessionId,
    endpointId: value.endpointId,
    legId: value.legId,
    providerCommandId: value.providerCommandId,
  };
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
    if (call.effectOwner !== "CANONICAL") {
      throw new ClaimCallError("Canonical routing does not own this call", 409);
    }
    if (call.direction !== "INBOUND") {
      throw new ClaimCallError("Only inbound calls can be claimed", 409);
    }

    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_endpoint" WHERE "practiceId" = ${actor.practiceId} AND "userId" = ${actor.userId} FOR UPDATE`,
    );
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_agent_session" WHERE "practiceId" = ${actor.practiceId} AND "userId" = ${actor.userId} AND "browserSessionId" = ${input.clientInstanceId} FOR UPDATE`,
    );
    const session = await this.transaction.callCenterAgentSession.findFirst({
      include: { endpoint: true },
      where: {
        browserSessionId: input.clientInstanceId,
        endpoint: { userId: actor.userId },
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
      session.endpoint.userId !== actor.userId ||
      !session.endpoint.providerCredentialId ||
      !session.endpoint.sipUsername
    ) {
      throw new ClaimCallError("Calling is not configured for this agent", 409);
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

    const claimedEvent = await this.transaction.callCenterEvent.findUnique({
      select: { data: true },
      where: {
        practiceId_type_idempotencyKey: {
          idempotencyKey: call.id,
          practiceId: call.practiceId,
          type: CALL_CLAIMED_EVENT,
        },
      },
    });
    if (claimedEvent) {
      const owner = claimOwner(claimedEvent.data);
      if (!owner) {
        throw new ClaimCallError("Claim ownership is inconsistent", 409);
      }
      if (owner.agentSessionId !== session.id) {
        await releaseAgentSessionReservation(this.transaction, {
          actorUserId: actor.userId,
          agentSessionId: session.id,
          callId: call.id,
          idempotencyKey: `claim-lost:${call.id}:${session.id}`,
          now,
          reason: "CLAIMED_BY_ANOTHER_AGENT",
        });
        return {
          agentSessionId: session.id,
          callId: call.id,
          endpointId: session.endpointId,
          legId: null,
          operationType: "CLAIM",
          providerCommandId: null,
          stateVersion: call.stateVersion,
          status: "ALREADY_CLAIMED",
        };
      }

      const command = await this.transaction.callCenterCommand.findUnique({
        select: {
          callId: true,
          id: true,
          legId: true,
          nextAttemptAt: true,
          practiceId: true,
          status: true,
          type: true,
        },
        where: { id: owner.providerCommandId },
      });
      if (
        !command ||
        command.callId !== call.id ||
        command.legId !== owner.legId ||
        command.practiceId !== call.practiceId ||
        command.type !== "DIAL_AGENT"
      ) {
        throw new ClaimCallError("Claim ownership is missing its provider command", 409);
      }
      return {
        agentSessionId: owner.agentSessionId,
        callId: call.id,
        endpointId: owner.endpointId,
        legId: owner.legId,
        operationType: "CLAIM",
        providerCommandId: command.id,
        stateVersion: call.stateVersion,
        status: operationStatus(command.status, command.nextAttemptAt),
      };
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
      const offered =
        session.offeredCallId === call.id &&
        session.currentCallId === null &&
        session.presence === "AVAILABLE";
      const active =
        session.offeredCallId === null &&
        session.currentCallId === call.id &&
        session.presence === "BUSY";
      if (!offered && !active) {
        throw new ClaimCallError("Existing claim session is inconsistent", 409);
      }
      const updatedCall = await this.transaction.callCenterCall.update({
        data: { stateVersion: { increment: 1 } },
        select: { stateVersion: true },
        where: { id: call.id },
      });
      await this.transaction.callCenterEvent.create({
        data: {
          actorUserId: actor.userId,
          aggregateId: call.id,
          aggregateType: "CALL",
          data: {
            agentSessionId: session.id,
            endpointId: session.endpointId,
            legId: existing.id,
            providerCommandId: existingCommand.id,
            stateVersion: updatedCall.stateVersion,
          },
          idempotencyKey: call.id,
          occurredAt: now,
          practiceId: call.practiceId,
          type: CALL_CLAIMED_EVENT,
        },
      });
      return {
        agentSessionId: session.id,
        callId: call.id,
        endpointId: session.endpointId,
        legId: existing.id,
        operationType: "CLAIM",
        providerCommandId: existingCommand.id,
        stateVersion: updatedCall.stateVersion,
        status: operationStatus(existingCommand.status, existingCommand.nextAttemptAt),
      };
    }

    if (session.stateVersion !== input.expectedSessionStateVersion) {
      throw new ClaimCallError("Agent session changed; refresh and try again", 409);
    }
    if (
      session.presence !== "AVAILABLE" ||
      session.currentCallId ||
      session.offeredCallId
    ) {
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
        offeredCallId: call.id,
        readyAt: null,
        stateVersion: { increment: 1 },
      },
      select: { stateVersion: true },
      where: { id: session.id },
    });
    const updatedCall = await this.transaction.callCenterCall.update({
      data: { stateVersion: { increment: 1 } },
      select: { stateVersion: true },
      where: { id: call.id },
    });

    await this.transaction.callCenterEvent.create({
      data: {
        actorUserId: actor.userId,
        aggregateId: call.id,
        aggregateType: "CALL",
        data: {
          agentSessionId: session.id,
          endpointId: session.endpointId,
          legId: leg.id,
          providerCommandId: command.id,
          stateVersion: updatedCall.stateVersion,
        },
        idempotencyKey: call.id,
        occurredAt: now,
        practiceId: call.practiceId,
        type: CALL_CLAIMED_EVENT,
      },
    });
    await this.transaction.callCenterEvent.create({
      data: {
        actorUserId: actor.userId,
        aggregateId: session.id,
        aggregateType: "AGENT_SESSION",
        data: {
          callId: call.id,
          presence: "AVAILABLE",
          stateVersion: updatedSession.stateVersion,
        },
        idempotencyKey: `claim-session:${leg.id}`,
        occurredAt: now,
        practiceId: call.practiceId,
        type: "AGENT_SESSION_CALL_OFFERED",
      },
    });

    return {
      agentSessionId: session.id,
      callId: call.id,
      endpointId: session.endpointId,
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
