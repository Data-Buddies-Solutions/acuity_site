import { randomUUID } from "crypto";

import { Prisma } from "@/generated/prisma/client";
import {
  StartOutboundCallError,
  type StartOutboundCallInput,
  type StartOutboundCallStore,
  type StartOutboundCallTransaction,
} from "@/lib/call-center/application/start-outbound-call";
import type {
  OperationReceiptData,
  OperationReceiptInput,
} from "@/lib/call-center/application/operation-receipts";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { resolveQueueAccess } from "@/lib/call-center/auth/queue-access";
import { isAgentSessionReady } from "@/lib/call-center/domain/agent-session-readiness";
import { resolveCallCenterActivationConfig } from "@/lib/call-center/infrastructure/call-center-activation-config";
import { PrismaOperationReceiptTransaction } from "@/lib/call-center/infrastructure/prisma-operation-receipts";
import { normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
export type StartOutboundCallTransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;
export type OutboundActivationEnabled = () => boolean;
export const OUTBOUND_INITIATION_TIMEOUT_MS = 60_000;

export function assertCanonicalOutboundActivation(
  activationEnabled: OutboundActivationEnabled,
) {
  if (!activationEnabled()) {
    throw new StartOutboundCallError("Canonical call center is not active", 409);
  }
}

export function canonicalOutboundClientState(input: {
  practiceId: string;
  token: string;
}) {
  return Buffer.from(
    JSON.stringify({
      canonicalOutboundToken: input.token,
      practiceId: input.practiceId,
      version: 1,
    }),
    "utf8",
  ).toString("base64");
}

export function isOutboundScopeAllowed(input: {
  actorAllowedLocationIds: string[];
  actorHasAllLocationAccess: boolean;
  endpointLocationId: string | null;
  numberLocationId: string | null;
  queueLocationIds: string[];
}) {
  const queueLocations = new Set(input.queueLocationIds);
  const endpointInQueue =
    queueLocations.size === 0 ||
    (input.endpointLocationId !== null && queueLocations.has(input.endpointLocationId));
  const numberInQueue =
    queueLocations.size === 0 ||
    (input.numberLocationId !== null && queueLocations.has(input.numberLocationId));
  const endpointInActorScope =
    input.actorHasAllLocationAccess ||
    (input.endpointLocationId !== null &&
      input.actorAllowedLocationIds.includes(input.endpointLocationId));
  const numberInActorScope =
    input.actorHasAllLocationAccess ||
    (input.numberLocationId !== null &&
      input.actorAllowedLocationIds.includes(input.numberLocationId));
  return endpointInQueue && numberInQueue && endpointInActorScope && numberInActorScope;
}

class PrismaStartOutboundCallTransaction implements StartOutboundCallTransaction {
  private readonly receipts: PrismaOperationReceiptTransaction;

  constructor(
    private readonly transaction: Transaction,
    private readonly activationEnabled: OutboundActivationEnabled,
  ) {
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

  async createOutboundCall(
    actor: QueueAccessActor,
    input: StartOutboundCallInput,
    now: Date,
  ) {
    assertCanonicalOutboundActivation(this.activationEnabled);

    await resolveQueueAccess(actor, input.queueId, this.transaction);
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_queue" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${input.queueId} FOR UPDATE`,
    );
    const queue = await this.transaction.callCenterQueue.findFirst({
      select: {
        locations: { select: { locationId: true } },
        members: {
          select: { id: true },
          where: { enabled: true, role: "AGENT", userId: actor.userId },
        },
      },
      where: { enabled: true, id: input.queueId, practiceId: actor.practiceId },
    });
    if (!queue || queue.members.length !== 1) {
      throw new StartOutboundCallError("Agent queue membership is required", 403);
    }

    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_number" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${input.numberId} FOR UPDATE`,
    );
    const number = await this.transaction.callCenterNumber.findFirst({
      include: { practicePhoneNumber: true },
      where: {
        enabled: true,
        id: input.numberId,
        outboundEnabled: true,
        practiceId: actor.practiceId,
      },
    });
    const queueLocationIds = new Set(queue.locations.map((row) => row.locationId));
    if (!number || number.practicePhoneNumber.practiceId !== actor.practiceId) {
      throw new StartOutboundCallError(
        "Outbound number is outside this queue scope",
        404,
      );
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
    const endpointLocationId = session?.endpoint.locationId ?? null;
    const numberLocationId = number.practicePhoneNumber.locationId;
    const scopeAllowed = isOutboundScopeAllowed({
      actorAllowedLocationIds: actor.allowedLocationIds,
      actorHasAllLocationAccess: actor.hasAllLocationAccess,
      endpointLocationId,
      numberLocationId,
      queueLocationIds: [...queueLocationIds],
    });
    if (
      !session ||
      session.stateVersion !== input.expectedSessionStateVersion ||
      session.leaseExpiresAt <= now ||
      !isAgentSessionReady(session) ||
      !session.endpoint.enabled ||
      !session.endpoint.providerCredentialId ||
      !session.endpoint.sipUsername ||
      !scopeAllowed
    ) {
      throw new StartOutboundCallError(
        "Canonical agent session is not ready for outbound calling",
        409,
      );
    }

    const from = normalizePhone(number.practicePhoneNumber.phoneNumber);
    const to = normalizePhone(input.destination);
    if (!/^\+[1-9]\d{7,14}$/.test(from) || !/^\+[1-9]\d{7,14}$/.test(to)) {
      throw new StartOutboundCallError("Outbound phone numbers must be valid E.164", 422);
    }

    const callId = randomUUID();
    const legId = randomUUID();
    const clientStateToken = randomUUID();
    const call = await this.transaction.callCenterCall.create({
      data: {
        direction: "OUTBOUND",
        effectOwner: "CANONICAL",
        fromPhone: from,
        id: callId,
        deadlineAt: new Date(now.getTime() + OUTBOUND_INITIATION_TIMEOUT_MS),
        numberId: number.id,
        practiceId: actor.practiceId,
        queueId: input.queueId,
        receivedAt: now,
        status: "RECEIVED",
        toPhone: to,
      },
      select: { id: true, stateVersion: true },
    });
    await this.transaction.callCenterCallLeg.create({
      data: {
        agentSessionId: session.id,
        callId: call.id,
        endpointId: session.endpointId,
        id: legId,
        kind: "AGENT",
        startedAt: now,
        status: "CREATED",
      },
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
    await this.transaction.callCenterEvent.create({
      data: {
        actorUserId: actor.userId,
        aggregateId: call.id,
        aggregateType: "CALL",
        data: {
          agentSessionId: session.id,
          direction: "OUTBOUND",
          endpointId: session.endpointId,
          legId,
          status: "RECEIVED",
        },
        idempotencyKey: `outbound-client-state:${clientStateToken}`,
        occurredAt: now,
        practiceId: actor.practiceId,
        type: "CALL_OUTBOUND_CREATED",
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
        idempotencyKey: `outbound-session:${call.id}`,
        occurredAt: now,
        practiceId: actor.practiceId,
        type: "AGENT_SESSION_CALL_OFFERED",
      },
    });

    return {
      aggregateId: call.id,
      data: {
        agentSessionId: session.id,
        callId: call.id,
        clientState: canonicalOutboundClientState({
          practiceId: actor.practiceId,
          token: clientStateToken,
        }),
        endpointId: session.endpointId,
        from,
        legId,
        operationType: "OUTBOUND",
        stateVersion: call.stateVersion,
        status: "CONFIRMED",
        to,
      },
    };
  }
}

export class PrismaStartOutboundCallStore implements StartOutboundCallStore {
  constructor(
    private readonly runTransaction: StartOutboundCallTransactionRunner = (operation) =>
      prisma.$transaction(operation),
    private readonly activationEnabled: OutboundActivationEnabled = () =>
      resolveCallCenterActivationConfig().enabled,
  ) {}

  transaction<T>(operation: (transaction: StartOutboundCallTransaction) => Promise<T>) {
    return this.runTransaction((transaction) =>
      operation(
        new PrismaStartOutboundCallTransaction(transaction, this.activationEnabled),
      ),
    );
  }
}

export const prismaStartOutboundCallStore = new PrismaStartOutboundCallStore();
