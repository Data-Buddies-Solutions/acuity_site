import { randomUUID } from "crypto";

import {
  Prisma,
  type CallCenterCallDirection,
  type CallCenterLegStatus,
} from "@/generated/prisma/client";
import {
  CALL_OUTBOUND_REQUESTED_EVENT,
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
import { lockCallCenterPractice } from "@/lib/call-center/infrastructure/prisma-call-center-practice-lock";
import { PrismaOperationReceiptTransaction } from "@/lib/call-center/infrastructure/prisma-operation-receipts";
import { settleCanonicalCallLegs } from "@/lib/call-center/infrastructure/prisma-call-resource-settlement";
import { normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;
export type StartOutboundCallTransactionRunner = <T>(
  operation: (transaction: Transaction) => Promise<T>,
) => Promise<T>;
const OUTBOUND_INITIATION_TIMEOUT_MS = 60_000;
const ACTIVE_LEG_STATUSES: readonly CallCenterLegStatus[] = ["ANSWERED", "BRIDGED"];
const PENDING_OUTBOUND_LEG_STATUSES: readonly CallCenterLegStatus[] = [
  "CREATED",
  "DIALING",
  "RINGING",
];

export function blocksOutboundStart(input: {
  direction: CallCenterCallDirection;
  status: CallCenterLegStatus;
}) {
  return (
    ACTIVE_LEG_STATUSES.includes(input.status) ||
    (input.direction === "OUTBOUND" &&
      PENDING_OUTBOUND_LEG_STATUSES.includes(input.status))
  );
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

function cleanupCommandIds(value: Prisma.JsonValue) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const ids = (value as Record<string, unknown>).cleanupCommandIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : [];
}

class PrismaStartOutboundCallTransaction implements StartOutboundCallTransaction {
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

  private async loadOutboundContext(
    actor: QueueAccessActor,
    input: StartOutboundCallInput,
    now: Date,
    lockRows: boolean,
  ) {
    await resolveQueueAccess(actor, input.queueId, this.transaction);
    if (lockRows) {
      await this.transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_queue" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${input.queueId} FOR UPDATE`,
      );
    }
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

    if (lockRows) {
      await this.transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_number" WHERE "practiceId" = ${actor.practiceId} AND "id" = ${input.numberId} FOR UPDATE`,
      );
    }
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

    if (lockRows) {
      await this.transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_endpoint" WHERE "practiceId" = ${actor.practiceId} AND "userId" = ${actor.userId} FOR UPDATE`,
      );
      await this.transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_agent_session" WHERE "practiceId" = ${actor.practiceId} AND "userId" = ${actor.userId} AND "browserSessionId" = ${input.clientInstanceId} FOR UPDATE`,
      );
    }
    const session = await this.transaction.callCenterAgentSession.findFirst({
      include: {
        endpoint: true,
      },
      where: {
        browserSessionId: input.clientInstanceId,
        endpoint: { userId: actor.userId },
        practiceId: actor.practiceId,
        userId: actor.userId,
      },
    });
    const blockingLeg = session
      ? await this.transaction.callCenterCallLeg.findFirst({
          select: { id: true },
          where: {
            endpointId: session.endpointId,
            kind: "AGENT",
            OR: [
              { status: { in: [...ACTIVE_LEG_STATUSES] } },
              {
                call: { direction: "OUTBOUND" },
                status: { in: [...PENDING_OUTBOUND_LEG_STATUSES] },
              },
            ],
          },
        })
      : null;
    const endpointLocationId = session?.endpoint.locationId ?? null;
    const numberLocationId = number.practicePhoneNumber.locationId;
    const scopeAllowed = isOutboundScopeAllowed({
      actorAllowedLocationIds: actor.allowedLocationIds,
      actorHasAllLocationAccess: actor.hasAllLocationAccess,
      endpointLocationId,
      numberLocationId,
      queueLocationIds: [...queueLocationIds],
    });
    // Heartbeats advance the revision; readiness comes from this locked row.
    if (
      !session ||
      session.leaseExpiresAt <= now ||
      !isAgentSessionReady(session) ||
      blockingLeg ||
      !session.endpoint.enabled ||
      session.endpoint.userId !== actor.userId ||
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

    return { from, number, session, to };
  }

  async prepareOutboundCleanup(
    actor: QueueAccessActor,
    input: StartOutboundCallInput,
    now: Date,
  ) {
    await lockCallCenterPractice(this.transaction, actor.practiceId);
    const receipt = await this.findReceipt(
      actor.practiceId,
      CALL_OUTBOUND_REQUESTED_EVENT,
      input.idempotencyKey,
    );
    if (receipt) return [];

    const { session } = await this.loadOutboundContext(actor, input, now, false);
    const eventPrefix = `outbound:${input.idempotencyKey}:settle:`;
    const priorEvents = await this.transaction.callCenterEvent.findMany({
      select: { data: true },
      where: {
        idempotencyKey: { startsWith: eventPrefix },
        practiceId: actor.practiceId,
        type: "CALL_AGENT_OFFER_ENDED",
      },
    });
    const priorCommandIds = priorEvents.flatMap(({ data }) => cleanupCommandIds(data));
    const offers = await this.transaction.callCenterCallLeg.findMany({
      orderBy: [{ callId: "asc" }, { id: "asc" }],
      select: { callId: true, id: true },
      where: {
        call: { direction: "INBOUND" },
        endpointId: session.endpointId,
        kind: "AGENT",
        status: { in: ["CREATED", "DIALING", "RINGING"] },
      },
    });
    for (const callId of [...new Set(offers.map(({ callId }) => callId))]) {
      await this.transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "call_center_call" WHERE "id" = ${callId} FOR UPDATE`,
      );
    }

    const liveOffers =
      offers.length === 0
        ? []
        : await this.transaction.callCenterCallLeg.findMany({
            orderBy: [{ callId: "asc" }, { id: "asc" }],
            select: { callId: true, id: true },
            where: {
              id: { in: offers.map(({ id }) => id) },
              status: { in: ["CREATED", "DIALING", "RINGING"] },
            },
          });
    const commandIds = [...priorCommandIds];
    for (const offer of liveOffers) {
      const settledCommandIds = await settleCanonicalCallLegs(this.transaction, {
        callId: offer.callId,
        hangupIdempotencyKeys: {
          [offer.id]: `outbound:${input.idempotencyKey}:hangup:${offer.id}`,
        },
        legIds: [offer.id],
        now,
        reason: "AGENT_STARTED_OUTBOUND",
      });
      commandIds.push(...settledCommandIds);
      await this.transaction.callCenterCall.update({
        data: { stateVersion: { increment: 1 } },
        where: { id: offer.callId },
      });
      const idempotencyKey = `${eventPrefix}${offer.id}`;
      const event = await this.transaction.callCenterEvent.findFirst({
        select: { revision: true },
        where: {
          idempotencyKey,
          practiceId: actor.practiceId,
          type: "CALL_AGENT_OFFER_ENDED",
        },
      });
      if (!event) {
        await this.transaction.callCenterEvent.create({
          data: {
            actorUserId: actor.userId,
            aggregateId: offer.callId,
            aggregateType: "CALL",
            data: {
              cleanupCommandIds: settledCommandIds,
              endpointId: session.endpointId,
              legId: offer.id,
              reason: "AGENT_STARTED_OUTBOUND",
            },
            idempotencyKey,
            occurredAt: now,
            practiceId: actor.practiceId,
            type: "CALL_AGENT_OFFER_ENDED",
          },
        });
      }
    }
    return [...new Set(commandIds)];
  }

  async createOutboundCall(
    actor: QueueAccessActor,
    input: StartOutboundCallInput,
    now: Date,
  ) {
    await lockCallCenterPractice(this.transaction, actor.practiceId);
    const { from, number, session, to } = await this.loadOutboundContext(
      actor,
      input,
      now,
      true,
    );
    const pendingOffer = await this.transaction.callCenterCallLeg.findFirst({
      select: { id: true },
      where: {
        call: { direction: "INBOUND" },
        endpointId: session.endpointId,
        kind: "AGENT",
        status: { in: ["CREATED", "DIALING", "RINGING"] },
      },
    });
    if (pendingOffer) {
      throw new StartOutboundCallError(
        "Inbound call offer cleanup is still pending",
        503,
      );
    }

    const callId = randomUUID();
    const legId = randomUUID();
    const clientStateToken = randomUUID();
    const call = await this.transaction.callCenterCall.create({
      data: {
        direction: "OUTBOUND",
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
        agentKey: `${call.id}:${session.endpointId}`,
        callId: call.id,
        endpointId: session.endpointId,
        id: legId,
        kind: "AGENT",
        startedAt: now,
        status: "CREATED",
      },
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
  ) {}

  transaction<T>(operation: (transaction: StartOutboundCallTransaction) => Promise<T>) {
    return this.runTransaction((transaction) =>
      operation(new PrismaStartOutboundCallTransaction(transaction)),
    );
  }

  prepareOutboundCleanup(
    actor: QueueAccessActor,
    input: StartOutboundCallInput,
    now = new Date(),
  ) {
    return this.runTransaction((transaction) =>
      new PrismaStartOutboundCallTransaction(transaction).prepareOutboundCleanup(
        actor,
        input,
        now,
      ),
    );
  }
}

export const prismaStartOutboundCallStore = new PrismaStartOutboundCallStore();
