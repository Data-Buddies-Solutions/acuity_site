import { randomUUID } from "crypto";

import { Prisma } from "@/generated/prisma/client";
import {
  TransferAgentCallError,
  type TransferAgentCallInput,
  type TransferAgentCallStore,
  type TransferAgentCallTransaction,
} from "@/lib/call-center/application/transfer-agent-call";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { resolveQueueAccess } from "@/lib/call-center/auth/queue-access";
import {
  LIVE_CANONICAL_LEG_STATUSES,
  UNBRIDGED_LIVE_CANONICAL_LEG_STATUSES,
} from "@/lib/call-center/domain/canonical-call-state";
import { lockCallCenterPractice } from "@/lib/call-center/infrastructure/prisma-call-center-practice-lock";
import { PrismaOperationReceiptTransaction } from "@/lib/call-center/infrastructure/prisma-operation-receipts";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;

async function transferContext(
  transaction: Transaction,
  actor: QueueAccessActor,
  input: Pick<TransferAgentCallInput, "callId" | "clientInstanceId">,
) {
  const call = await transaction.callCenterCall.findFirst({
    include: {
      number: { select: { practicePhoneNumber: { select: { locationId: true } } } },
      winningLeg: {
        include: {
          agentSession: true,
          endpoint: true,
        },
      },
      legs: {
        include: {
          agentSession: true,
          endpoint: true,
        },
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
        where: { status: { in: ["ANSWERED", "BRIDGED"] } },
      },
    },
    where: { id: input.callId, practiceId: actor.practiceId },
  });
  if (!call?.queueId) {
    throw new TransferAgentCallError("Canonical call not found", 404);
  }
  await resolveQueueAccess(actor, call.queueId, transaction);
  const locationId = call.number.practicePhoneNumber.locationId;
  if (
    !locationId ||
    (!actor.hasAllLocationAccess && !actor.allowedLocationIds.includes(locationId))
  ) {
    throw new TransferAgentCallError("Canonical call not found", 404);
  }
  const ownedAgentLegs = call.legs.filter(
    (leg) =>
      leg.kind === "AGENT" &&
      leg.endpoint?.userId === actor.userId &&
      leg.agentSession?.browserSessionId === input.clientInstanceId &&
      Boolean(leg.providerCallControlId),
  );
  const source =
    call.winningLeg ??
    (call.direction === "OUTBOUND" && ownedAgentLegs.length === 1
      ? ownedAgentLegs[0]
      : null);
  if (
    call.status !== "CONNECTED" ||
    !source ||
    source.kind !== "AGENT" ||
    !["ANSWERED", "BRIDGED"].includes(source.status) ||
    !source.providerCallControlId ||
    source.endpoint?.userId !== actor.userId ||
    source.agentSession?.browserSessionId !== input.clientInstanceId
  ) {
    throw new TransferAgentCallError("Call is not connected to this phone", 409);
  }
  const providerSources =
    call.direction === "INBOUND"
      ? call.legs.filter(
          (leg) => leg.kind === "CUSTOMER" && Boolean(leg.providerCallControlId),
        )
      : [source];
  if (providerSources.length !== 1) {
    throw new TransferAgentCallError("Call is not connected to this phone", 409);
  }
  return { call, locationId, providerSource: providerSources[0]!, source };
}

async function readyTransferTargets(
  transaction: Transaction,
  actor: QueueAccessActor,
  input: Pick<TransferAgentCallInput, "callId" | "clientInstanceId">,
  now: Date,
) {
  const { call, locationId, providerSource, source } = await transferContext(
    transaction,
    actor,
    input,
  );
  const endpoints = await transaction.callCenterEndpoint.findMany({
    orderBy: [{ label: "asc" }, { id: "asc" }],
    select: {
      id: true,
      label: true,
      sipUsername: true,
      userId: true,
      agentSessions: {
        orderBy: [{ lastHeartbeatAt: "desc" }, { id: "asc" }],
        select: { id: true },
        take: 1,
        where: {
          audioReady: true,
          connectionState: "READY",
          leaseExpiresAt: { gt: now },
          microphoneReady: true,
          presence: "AVAILABLE",
        } satisfies Prisma.CallCenterAgentSessionWhereInput,
      },
    },
    where: {
      callLegs: {
        none: { kind: "AGENT", status: { in: [...LIVE_CANONICAL_LEG_STATUSES] } },
      },
      enabled: true,
      id: { not: source.endpointId ?? undefined },
      locationId,
      practiceId: actor.practiceId,
      sipUsername: { not: null },
      user: {
        memberships: {
          some: {
            OR: [{ locationScope: "ALL" }, { locations: { some: { locationId } } }],
            practiceId: actor.practiceId,
          },
        },
      },
      userId: {
        not: actor.userId,
        in: (
          await transaction.callCenterQueueMember.findMany({
            select: { userId: true },
            where: { enabled: true, queueId: call.queueId!, role: "AGENT" },
          })
        ).map(({ userId }) => userId),
      },
    },
  });
  return {
    call,
    providerSource,
    source,
    targets: endpoints.filter(
      (endpoint) => endpoint.userId && endpoint.sipUsername && endpoint.agentSessions[0],
    ),
  };
}

class PrismaTransferAgentCallTransaction implements TransferAgentCallTransaction {
  private readonly receipts: PrismaOperationReceiptTransaction;

  constructor(private readonly transaction: Transaction) {
    this.receipts = new PrismaOperationReceiptTransaction(transaction);
  }

  appendReceipt(
    ...input: Parameters<PrismaOperationReceiptTransaction["appendReceipt"]>
  ) {
    return this.receipts.appendReceipt(...input);
  }

  findReceipt(...input: Parameters<PrismaOperationReceiptTransaction["findReceipt"]>) {
    return this.receipts.findReceipt(...input);
  }

  lockReceiptKey(
    ...input: Parameters<PrismaOperationReceiptTransaction["lockReceiptKey"]>
  ) {
    return this.receipts.lockReceiptKey(...input);
  }

  async saveTransfer(actor: QueueAccessActor, input: TransferAgentCallInput, now: Date) {
    await lockCallCenterPractice(this.transaction, actor.practiceId);
    await this.transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "id" = ${input.callId} AND "practiceId" = ${actor.practiceId} FOR UPDATE`,
    );
    const { call, providerSource, source, targets } = await readyTransferTargets(
      this.transaction,
      actor,
      input,
      now,
    );
    if (call.stateVersion !== input.expectedStateVersion) {
      throw new TransferAgentCallError("Call changed; refresh and try again", 409);
    }
    const target = targets.find(({ id }) => id === input.targetEndpointId);
    const targetSession = target?.agentSessions[0];
    if (!target || !targetSession) {
      throw new TransferAgentCallError("Transfer target is not available", 409);
    }
    const transferInFlight = await this.transaction.callCenterCommand.findFirst({
      select: { id: true },
      where: {
        callId: call.id,
        leg: { status: { in: [...UNBRIDGED_LIVE_CANONICAL_LEG_STATUSES] } },
        status: { in: ["PENDING", "SENDING", "SENT", "CONFIRMED"] },
        type: "TRANSFER_AGENT",
      },
    });
    if (transferInFlight) {
      throw new TransferAgentCallError("A transfer is already in progress", 409);
    }

    const targetLegId = randomUUID();
    const commandId = randomUUID();
    await this.transaction.callCenterCallLeg.create({
      data: {
        agentKey: `transfer:${call.id}:${input.idempotencyKey}`,
        agentSessionId: targetSession.id,
        callId: call.id,
        endpointId: target.id,
        id: targetLegId,
        kind: "AGENT",
        startedAt: now,
        status: "CREATED",
      },
    });
    await this.transaction.callCenterCommand.create({
      data: {
        arguments: {
          agentSessionId: targetSession.id,
          endpointId: target.id,
          providerSourceLegId: providerSource.id,
          sourceLegId: source.id,
        },
        callId: call.id,
        id: commandId,
        idempotencyKey: `transfer:${input.idempotencyKey}`,
        legId: targetLegId,
        practiceId: actor.practiceId,
        type: "TRANSFER_AGENT",
      },
    });
    const updated = await this.transaction.callCenterCall.update({
      data: {
        stateVersion: { increment: 1 },
        ...(call.winningLegId ? {} : { winningLegId: source.id }),
      },
      select: { stateVersion: true },
      where: { id: call.id },
    });
    return {
      callId: call.id,
      commandId,
      operationType: "TRANSFER" as const,
      sourceLegId: source.id,
      stateVersion: updated.stateVersion,
      status: "PENDING" as const,
      targetEndpointId: target.id,
      targetLegId,
    };
  }
}

export class PrismaTransferAgentCallStore implements TransferAgentCallStore {
  constructor(
    private readonly run = <T>(operation: (transaction: Transaction) => Promise<T>) =>
      prisma.$transaction(operation),
  ) {}

  listTargets(
    actor: QueueAccessActor,
    input: Pick<TransferAgentCallInput, "callId" | "clientInstanceId">,
    now = new Date(),
  ) {
    return this.run(async (transaction) => {
      const { targets } = await readyTransferTargets(transaction, actor, input, now);
      return targets.map(({ id, label }) => ({ endpointId: id, label }));
    });
  }

  transaction<T>(operation: (transaction: TransferAgentCallTransaction) => Promise<T>) {
    return this.run((transaction) =>
      operation(new PrismaTransferAgentCallTransaction(transaction)),
    );
  }
}

export const prismaTransferAgentCallStore = new PrismaTransferAgentCallStore();
