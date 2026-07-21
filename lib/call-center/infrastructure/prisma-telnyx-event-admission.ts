import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { directHandoffCorrelationLockKey } from "@/lib/call-center/infrastructure/direct-handoff-correlation";
import { hasDirectHandoffIdentity } from "@/lib/call-center/infrastructure/direct-handoff-uri";
import { lockCallCenterPractice } from "@/lib/call-center/infrastructure/prisma-call-center-practice-lock";
import type { ProviderWebhookRecord } from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

type AdmissionDatabase = Pick<PrismaClient, "$transaction">;
type AdmissionTransaction = Pick<
  Prisma.TransactionClient,
  | "$queryRaw"
  | "callCenterCall"
  | "callCenterEvent"
  | "callCenterHandoff"
  | "callCenterCallLeg"
  | "callCenterNumber"
  | "providerWebhookEvent"
>;

type PersistedCall = {
  id: string;
  practiceId: string;
  providerCallSessionId: string | null;
};

type RawIdentity = {
  callerName: string | null;
  canonicalCallId: string | null;
  canonicalLegId: string | null;
  canonicalOutboundPracticeId: string | null;
  canonicalOutboundToken: string | null;
  direction: "INBOUND" | "OUTBOUND" | "UNKNOWN" | null;
  directHandoff: { tokenHash: string } | null;
  fromPhone: string;
  occurredAt: Date;
  providerCallControlId: string | null;
  providerCallLegId: string | null;
  providerCallSessionId: string | null;
  toPhone: string;
};

type PersistedLeg = {
  call: PersistedCall;
  id: string;
  kind: "AGENT" | "CUSTOMER";
  providerCallControlId: string | null;
  providerCallLegId: string | null;
  providerCallSessionId: string | null;
};

export class TelnyxEventAdmissionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TelnyxEventAdmissionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function direction(value: unknown): RawIdentity["direction"] {
  const normalized = text(value).toLowerCase();
  if (!normalized) return null;
  if (normalized === "incoming" || normalized === "inbound") return "INBOUND";
  if (normalized === "outgoing" || normalized === "outbound") return "OUTBOUND";
  return "UNKNOWN";
}

function optionalDate(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clientState(value: unknown) {
  const encoded = text(value);
  if (!encoded) return null;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    return isRecord(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function rawIdentity(event: ProviderWebhookRecord): RawIdentity {
  const body = isRecord(event.payload) ? event.payload : null;
  const data = isRecord(body?.data) ? body.data : null;
  const payload = isRecord(data?.payload) ? data.payload : null;
  if (!payload) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_PAYLOAD_INVALID");
  }

  const state = clientState(payload.client_state);
  const canonicalOutboundToken = text(state?.canonicalOutboundToken) || null;
  const canonicalOutboundPracticeId = text(state?.practiceId) || null;
  if (canonicalOutboundToken && !canonicalOutboundPracticeId) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_OUTBOUND_TOKEN_INCOMPLETE");
  }
  const canonicalCallId = canonicalOutboundToken ? null : text(state?.callId) || null;
  const canonicalLegId = canonicalOutboundToken ? null : text(state?.legId) || null;
  if (Boolean(canonicalCallId) !== Boolean(canonicalLegId)) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_CANONICAL_IDENTITY_INCOMPLETE");
  }
  let directHandoff: RawIdentity["directHandoff"];
  try {
    const identity = hasDirectHandoffIdentity(payload);
    if (Boolean(identity) !== Boolean(event.directHandoffTokenHash)) {
      throw new Error("DIRECT_HANDOFF_IDENTITY_INVALID");
    }
    directHandoff = identity ? { tokenHash: event.directHandoffTokenHash! } : null;
  } catch {
    throw new TelnyxEventAdmissionError("TELNYX_DIRECT_HANDOFF_IDENTITY_INVALID");
  }

  return {
    callerName: text(payload.caller_id_name) || null,
    canonicalCallId,
    canonicalLegId,
    canonicalOutboundPracticeId,
    canonicalOutboundToken,
    direction: direction(payload.direction),
    directHandoff,
    fromPhone: normalizePhone(text(payload.from)),
    occurredAt:
      optionalDate(data?.occurred_at) ??
      optionalDate(payload.occurred_at) ??
      event.updatedAt,
    providerCallControlId: text(payload.call_control_id) || null,
    providerCallLegId: text(payload.call_leg_id) || null,
    providerCallSessionId: text(payload.call_session_id) || null,
    toPhone: normalizePhone(text(payload.to)),
  };
}

async function admitDirectHandoff(
  tx: AdmissionTransaction,
  raw: RawIdentity,
  receivedAt: Date,
) {
  const identity = raw.directHandoff;
  if (raw.direction !== "INBOUND") {
    if (identity) {
      throw new TelnyxEventAdmissionError(
        "TELNYX_DIRECT_HANDOFF_PROVIDER_IDENTITY_INVALID",
      );
    }
    return null;
  }
  if (!raw.providerCallSessionId) {
    if (!identity) return null;
    throw new TelnyxEventAdmissionError(
      "TELNYX_DIRECT_HANDOFF_PROVIDER_IDENTITY_INVALID",
    );
  }

  let identifiedHandoff: { id: string; practiceId: string } | null = null;
  if (identity) {
    const identified = await tx.callCenterHandoff.findUnique({
      select: { id: true, practiceId: true },
      where: { tokenHash: identity.tokenHash },
    });
    if (!identified) {
      throw new TelnyxEventAdmissionError("TELNYX_DIRECT_HANDOFF_TOKEN_INVALID");
    }
    identifiedHandoff = identified;
  } else {
    if (!raw.fromPhone || !raw.toPhone) return null;
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${directHandoffCorrelationLockKey(raw.fromPhone, raw.toPhone)}, 0))::text AS "lock"`,
    );
    const candidates = await tx.callCenterHandoff.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, practiceId: true },
      take: 2,
      where: {
        callerPhone: raw.fromPhone,
        createdAt: { lte: receivedAt },
        expiresAt: { gt: receivedAt },
        number: {
          practicePhoneNumber: {
            phoneNumber: { in: phoneLookupVariants(raw.toPhone) },
          },
        },
        status: { in: ["ISSUED", "INGRESS_SEEN", "CONNECTED", "FAILED"] },
      },
    });
    if (candidates.length > 1) {
      throw new TelnyxEventAdmissionError("TELNYX_DIRECT_HANDOFF_CORRELATION_AMBIGUOUS");
    }
    identifiedHandoff = candidates[0] ?? null;
    if (!identifiedHandoff) return null;
  }

  await lockCallCenterPractice(tx, identifiedHandoff.practiceId);
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_handoff" WHERE "id" = ${identifiedHandoff.id} FOR UPDATE`,
  );
  let handoff = await tx.callCenterHandoff.findUnique({
    include: {
      number: { include: { practicePhoneNumber: true } },
      queue: true,
    },
    where: { id: identifiedHandoff.id },
  });
  if (!handoff) {
    throw new TelnyxEventAdmissionError("TELNYX_DIRECT_HANDOFF_NOT_FOUND");
  }
  if (
    handoff.status === "INGRESS_SEEN" &&
    handoff.providerCallSessionId === raw.providerCallSessionId &&
    handoff.callId
  ) {
    return "ADMITTED" as const;
  }
  if (handoff.status !== "ISSUED" || handoff.expiresAt <= receivedAt) {
    throw new TelnyxEventAdmissionError("TELNYX_DIRECT_HANDOFF_NOT_TRANSFERABLE");
  }

  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "practice_phone_number" WHERE "id" = ${handoff.number.practicePhoneNumberId} FOR SHARE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_number" WHERE "id" = ${handoff.numberId} FOR SHARE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_queue" WHERE "id" = ${handoff.queueId} FOR SHARE`,
  );
  handoff = await tx.callCenterHandoff.findUnique({
    include: {
      number: { include: { practicePhoneNumber: true } },
      queue: true,
    },
    where: { id: identifiedHandoff.id },
  });
  if (!handoff) {
    throw new TelnyxEventAdmissionError("TELNYX_DIRECT_HANDOFF_ROUTE_CHANGED");
  }
  // ISSUED already authorized the route. The practice lock protects its tenant boundary;
  // later configuration edits must not reroute or strand an in-flight REFER.
  if (
    handoff.number.practiceId !== handoff.practiceId ||
    handoff.number.practicePhoneNumber.practiceId !== handoff.practiceId ||
    handoff.queue.practiceId !== handoff.practiceId
  ) {
    throw new TelnyxEventAdmissionError("TELNYX_DIRECT_HANDOFF_ROUTE_CHANGED");
  }

  const call = await tx.callCenterCall.create({
    data: {
      direction: "INBOUND",
      fromPhone: handoff.callerPhone,
      legs: {
        create: {
          kind: "CUSTOMER",
          providerCallControlId: raw.providerCallControlId,
          providerCallLegId: raw.providerCallLegId,
          providerCallSessionId: raw.providerCallSessionId,
          startedAt: raw.occurredAt,
        },
      },
      numberId: handoff.numberId,
      practiceId: handoff.practiceId,
      providerCallSessionId: raw.providerCallSessionId,
      queueId: handoff.queueId,
      receivedAt: raw.occurredAt,
      toPhone: handoff.number.practicePhoneNumber.phoneNumber,
    },
    select: { id: true },
  });
  await tx.callCenterHandoff.update({
    data: {
      callId: call.id,
      ingressSeenAt: receivedAt,
      providerCallSessionId: raw.providerCallSessionId,
      status: "INGRESS_SEEN",
    },
    where: { id: handoff.id },
  });
  return "ADMITTED" as const;
}

async function resolveTrustedOutboundIdentity(
  tx: AdmissionTransaction,
  raw: RawIdentity,
) {
  if (!raw.canonicalOutboundToken) return raw;
  if (
    !raw.canonicalOutboundPracticeId ||
    (raw.direction !== null && raw.direction !== "OUTBOUND")
  ) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_OUTBOUND_TOKEN_INVALID");
  }
  const mapping = await tx.callCenterEvent.findUnique({
    select: { aggregateId: true, aggregateType: true, data: true },
    where: {
      practiceId_type_idempotencyKey: {
        idempotencyKey: `outbound-client-state:${raw.canonicalOutboundToken}`,
        practiceId: raw.canonicalOutboundPracticeId,
        type: "CALL_OUTBOUND_CREATED",
      },
    },
  });
  const data = isRecord(mapping?.data) ? mapping.data : null;
  const legId = text(data?.legId);
  if (!mapping || mapping.aggregateType !== "CALL" || !mapping.aggregateId || !legId) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_OUTBOUND_TOKEN_NOT_FOUND");
  }
  return { ...raw, canonicalCallId: mapping.aggregateId, canonicalLegId: legId };
}

async function lockProviderSession(
  tx: AdmissionTransaction,
  eventId: string,
  providerCallSessionId: string | null,
) {
  const lockKey = telnyxEventAdmissionLockKey(eventId, providerCallSessionId);
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "lock"`,
  );
}

export function telnyxEventAdmissionLockKey(
  eventId: string,
  providerCallSessionId: string | null,
) {
  return providerCallSessionId
    ? `TELNYX_SESSION:${providerCallSessionId}`
    : `TELNYX_EVENT:${eventId}`;
}

async function sessionRejection(
  tx: AdmissionTransaction,
  event: ProviderWebhookRecord,
  providerCallSessionId: string | null,
) {
  if (!providerCallSessionId) return null;
  const directHandoff = await tx.providerWebhookEvent.findFirst({
    select: { errorCode: true },
    where: {
      errorCode: { startsWith: "TELNYX_DIRECT_HANDOFF_" },
      id: { not: event.id },
      processingStatus: "IGNORED",
      provider: "TELNYX",
      providerCallSessionId,
    },
  });
  if (directHandoff) return "DIRECT_HANDOFF" as const;
  const outOfScope = await tx.providerWebhookEvent.findFirst({
    select: { errorCode: true },
    where: {
      errorCode: "TELNYX_EVENT_OUT_OF_SCOPE",
      id: { not: event.id },
      processingStatus: "IGNORED",
      provider: "TELNYX",
      providerCallSessionId,
    },
  });
  return outOfScope ? ("OUT_OF_SCOPE" as const) : null;
}

function assertLegIdentity(raw: RawIdentity, leg: PersistedLeg) {
  const expectedSessionId =
    leg.providerCallSessionId ??
    (leg.kind === "CUSTOMER" ? leg.call.providerCallSessionId : null);
  const mismatch =
    (raw.canonicalLegId && raw.canonicalLegId !== leg.id) ||
    (raw.canonicalCallId && raw.canonicalCallId !== leg.call.id) ||
    (raw.providerCallControlId &&
      leg.providerCallControlId &&
      raw.providerCallControlId !== leg.providerCallControlId) ||
    (raw.providerCallLegId &&
      leg.providerCallLegId &&
      raw.providerCallLegId !== leg.providerCallLegId) ||
    (raw.providerCallSessionId &&
      expectedSessionId &&
      raw.providerCallSessionId !== expectedSessionId);
  if (mismatch) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_IDENTITY_MISMATCH");
  }
}

const legAdmissionSelect = {
  call: {
    select: {
      id: true,
      practiceId: true,
      providerCallSessionId: true,
    },
  },
  id: true,
  kind: true,
  providerCallControlId: true,
  providerCallLegId: true,
  providerCallSessionId: true,
} as const;

async function findAndBindLegIdentity(tx: AdmissionTransaction, raw: RawIdentity) {
  const identities = [
    ...(raw.canonicalLegId ? [{ id: raw.canonicalLegId }] : []),
    ...(raw.providerCallControlId
      ? [{ providerCallControlId: raw.providerCallControlId }]
      : []),
    ...(raw.providerCallLegId ? [{ providerCallLegId: raw.providerCallLegId }] : []),
  ];
  if (identities.length === 0) return null;

  const matches = await tx.callCenterCallLeg.findMany({
    select: legAdmissionSelect,
    take: 2,
    where: { OR: identities },
  });
  if (matches.length > 1) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_IDENTITY_AMBIGUOUS");
  }
  const match = matches[0];
  if (!match) return null;

  await lockCallCenterPractice(tx, match.call.practiceId);
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_call_leg" WHERE "id" = ${match.id} FOR UPDATE`,
  );
  const leg = await tx.callCenterCallLeg.findUnique({
    select: legAdmissionSelect,
    where: { id: match.id },
  });
  if (!leg) throw new TelnyxEventAdmissionError("TELNYX_EVENT_LEG_NOT_FOUND");
  assertLegIdentity(raw, leg);

  try {
    const bound = await tx.callCenterCallLeg.update({
      data: {
        providerCallControlId: leg.providerCallControlId ?? raw.providerCallControlId,
        providerCallLegId: leg.providerCallLegId ?? raw.providerCallLegId,
        providerCallSessionId: leg.providerCallSessionId ?? raw.providerCallSessionId,
      },
      select: legAdmissionSelect,
      where: { id: leg.id },
    });
    assertLegIdentity(raw, bound);
    return bound.call.id;
  } catch (error) {
    if (isRecord(error) && error.code === "P2002") {
      throw new TelnyxEventAdmissionError("TELNYX_EVENT_PROVIDER_IDENTITY_CONFLICT");
    }
    throw error;
  }
}

async function findByCustomerSession(tx: AdmissionTransaction, raw: RawIdentity) {
  if (raw.direction === "OUTBOUND" || !raw.providerCallSessionId) return null;
  const call = await tx.callCenterCall.findUnique({
    select: {
      id: true,
      practiceId: true,
      providerCallSessionId: true,
    },
    where: { providerCallSessionId: raw.providerCallSessionId },
  });
  if (!call) return null;
  if (raw.canonicalCallId && raw.canonicalCallId !== call.id) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_IDENTITY_MISMATCH");
  }
  await lockCallCenterPractice(tx, call.practiceId);
  return call.id;
}

async function configuredInboundNumber(tx: AdmissionTransaction, toPhone: string) {
  if (!toPhone) return null;
  const numbers = await tx.callCenterNumber.findMany({
    select: {
      id: true,
      inboundQueueId: true,
      practiceId: true,
      practicePhoneNumberId: true,
    },
    take: 2,
    where: {
      enabled: true,
      inboundEnabled: true,
      practicePhoneNumber: { phoneNumber: { in: phoneLookupVariants(toPhone) } },
    },
  });
  if (numbers.length > 1) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_NUMBER_OWNER_AMBIGUOUS");
  }
  return numbers[0] ?? null;
}

async function lockQueue(
  tx: AdmissionTransaction,
  queueId: string,
): Promise<{
  enabled: boolean;
  id: string;
  practiceId: string;
}> {
  const queues = await tx.$queryRaw<
    Array<{
      enabled: boolean;
      id: string;
      practiceId: string;
    }>
  >(Prisma.sql`
    SELECT "id", "practiceId", "enabled"
    FROM "call_center_queue"
    WHERE "id" = ${queueId}
    FOR SHARE
  `);
  const queue = queues[0];
  if (!queue) throw new TelnyxEventAdmissionError("TELNYX_EVENT_QUEUE_NOT_FOUND");
  return queue;
}

async function lockNumber(tx: AdmissionTransaction, numberId: string) {
  const numbers = await tx.$queryRaw<
    Array<{
      enabled: boolean;
      id: string;
      inboundEnabled: boolean;
      inboundQueueId: string | null;
      phoneNumber: string;
      practiceId: string;
      practicePhoneNumberId: string;
    }>
  >(Prisma.sql`
    SELECT
      number."id",
      number."practiceId",
      number."practicePhoneNumberId",
      number."inboundQueueId",
      number."inboundEnabled",
      number."enabled",
      phone."phoneNumber"
    FROM "call_center_number" AS number
    JOIN "practice_phone_number" AS phone
      ON phone."id" = number."practicePhoneNumberId"
    WHERE number."id" = ${numberId}
    FOR SHARE OF number, phone
  `);
  const number = numbers[0];
  if (!number) throw new TelnyxEventAdmissionError("TELNYX_EVENT_NUMBER_NOT_FOUND");
  return number;
}

async function admitInboundCall(tx: AdmissionTransaction, raw: RawIdentity) {
  if (raw.direction !== "INBOUND") return null;
  if (!raw.providerCallSessionId) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_CALL_SESSION_MISSING");
  }

  const number = await configuredInboundNumber(tx, raw.toPhone);
  if (!number) return null;
  if (!number.inboundQueueId) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_NUMBER_QUEUE_MISSING");
  }
  if (!raw.fromPhone) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_CALLER_IDENTITY_MISSING");
  }

  await lockCallCenterPractice(tx, number.practiceId);
  const queue = await lockQueue(tx, number.inboundQueueId);
  const lockedNumber = await lockNumber(tx, number.id);
  if (!queue.enabled) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_QUEUE_DISABLED");
  }
  if (
    !lockedNumber.enabled ||
    !lockedNumber.inboundEnabled ||
    lockedNumber.inboundQueueId !== queue.id ||
    lockedNumber.practicePhoneNumberId !== number.practicePhoneNumberId ||
    !phoneLookupVariants(raw.toPhone).includes(lockedNumber.phoneNumber)
  ) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_NUMBER_CHANGED");
  }
  if (queue.practiceId !== lockedNumber.practiceId) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_QUEUE_PRACTICE_MISMATCH");
  }

  await tx.callCenterCall.create({
    data: {
      callerName: raw.callerName,
      direction: "INBOUND",
      fromPhone: raw.fromPhone,
      legs: {
        create: {
          kind: "CUSTOMER",
          providerCallControlId: raw.providerCallControlId,
          providerCallLegId: raw.providerCallLegId,
          providerCallSessionId: raw.providerCallSessionId,
          startedAt: raw.occurredAt,
        },
      },
      numberId: lockedNumber.id,
      practiceId: lockedNumber.practiceId,
      providerCallSessionId: raw.providerCallSessionId,
      queueId: queue.id,
      receivedAt: raw.occurredAt,
      toPhone: raw.toPhone,
    },
    select: { id: true },
  });
  return "ADMITTED" as const;
}

async function bindProviderSession(
  tx: AdmissionTransaction,
  event: ProviderWebhookRecord,
  raw: RawIdentity,
) {
  const assigned = await tx.providerWebhookEvent.updateMany({
    data: {
      providerCallSessionId: raw.providerCallSessionId,
    },
    where: {
      attemptCount: event.attemptCount,
      id: event.id,
      processingStatus: "PROCESSING",
    },
  });
  if (assigned.count !== 1) {
    throw new TelnyxEventAdmissionError("TELNYX_EVENT_ADMISSION_CLAIM_LOST");
  }
}

/**
 * Admits one durable provider event before projection. The durable inbox
 * payload is the source of identity, and provider-session serialization keeps
 * callbacks ordered across retries and configuration changes.
 */
export async function admitTelnyxEvent(
  event: ProviderWebhookRecord,
  database: AdmissionDatabase = prisma,
): Promise<"ADMITTED"> {
  const unresolvedRaw = rawIdentity(event);
  return database.$transaction(async (tx) => {
    const admissionTx = tx as AdmissionTransaction;
    await lockProviderSession(admissionTx, event.id, unresolvedRaw.providerCallSessionId);
    const raw = await resolveTrustedOutboundIdentity(admissionTx, unresolvedRaw);
    const rejectedSession = await sessionRejection(
      admissionTx,
      event,
      raw.providerCallSessionId,
    );
    if (rejectedSession === "DIRECT_HANDOFF") {
      throw new TelnyxEventAdmissionError("TELNYX_DIRECT_HANDOFF_NOT_TRANSFERABLE");
    }

    let legCallId: string | null;
    try {
      legCallId = await findAndBindLegIdentity(admissionTx, raw);
    } catch (error) {
      if (
        rejectedSession === "OUT_OF_SCOPE" &&
        error instanceof TelnyxEventAdmissionError
      ) {
        throw new TelnyxEventAdmissionError("TELNYX_EVENT_OUT_OF_SCOPE");
      }
      throw error;
    }
    if (!legCallId && raw.canonicalLegId) {
      if (rejectedSession === "OUT_OF_SCOPE") {
        throw new TelnyxEventAdmissionError("TELNYX_EVENT_OUT_OF_SCOPE");
      }
      throw new TelnyxEventAdmissionError("TELNYX_EVENT_CANONICAL_IDENTITY_NOT_FOUND");
    }
    // A signed callback that binds to an already-authorized canonical leg has
    // stronger identity than a session-wide rejection. Telnyx transfers can
    // emit an untagged peer event in the same provider session; that peer may
    // remain out of scope without poisoning later source/target callbacks.
    const hasCanonicalLegIdentity = Boolean(
      legCallId && raw.canonicalCallId && raw.canonicalLegId,
    );
    if (rejectedSession === "OUT_OF_SCOPE" && !hasCanonicalLegIdentity) {
      throw new TelnyxEventAdmissionError("TELNYX_EVENT_OUT_OF_SCOPE");
    }
    const sessionCallId = await findByCustomerSession(admissionTx, raw);
    if (legCallId && sessionCallId && legCallId !== sessionCallId) {
      throw new TelnyxEventAdmissionError("TELNYX_EVENT_IDENTITY_MISMATCH");
    }
    const admission =
      legCallId ??
      sessionCallId ??
      (await admitDirectHandoff(admissionTx, raw, raw.occurredAt)) ??
      (await admitInboundCall(admissionTx, raw));
    if (!admission) {
      throw new TelnyxEventAdmissionError("TELNYX_EVENT_OUT_OF_SCOPE");
    }

    await bindProviderSession(admissionTx, event, raw);
    return "ADMITTED" as const;
  });
}
