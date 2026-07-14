import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { resolveCallCenterActivationConfig } from "@/lib/call-center/infrastructure/call-center-activation-config";
import { hasDirectHandoffIdentity } from "@/lib/call-center/infrastructure/direct-handoff-uri";
import type { ProviderWebhookRecord } from "@/lib/call-center/infrastructure/provider-webhook-inbox";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

export type TelnyxEventOwner = "CANONICAL" | "LEGACY";

type OwnerDatabase = Pick<PrismaClient, "$transaction">;
type OwnerTransaction = Pick<
  Prisma.TransactionClient,
  | "$queryRaw"
  | "callCenterCall"
  | "callCenterEvent"
  | "callCenterHandoff"
  | "callCenterCallLeg"
  | "callCenterNumber"
  | "providerWebhookEvent"
>;

type PersistedOwner = {
  effectOwner: TelnyxEventOwner;
  id: string;
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
  call: PersistedOwner;
  id: string;
  kind: "AGENT" | "CUSTOMER";
  providerCallControlId: string | null;
  providerCallLegId: string | null;
  providerCallSessionId: string | null;
};

export class TelnyxEventOwnerError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TelnyxEventOwnerError";
  }
}

function ownerForNewAdmission(activationEnabled: boolean) {
  return activationEnabled ? "CANONICAL" : "LEGACY";
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
    throw new TelnyxEventOwnerError("TELNYX_EVENT_PAYLOAD_INVALID");
  }

  const state = clientState(payload.client_state);
  const canonicalOutboundToken = text(state?.canonicalOutboundToken) || null;
  const canonicalOutboundPracticeId = text(state?.practiceId) || null;
  if (canonicalOutboundToken && !canonicalOutboundPracticeId) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_OUTBOUND_TOKEN_INCOMPLETE");
  }
  const canonicalCallId = canonicalOutboundToken ? null : text(state?.callId) || null;
  const canonicalLegId = canonicalOutboundToken ? null : text(state?.legId) || null;
  if (Boolean(canonicalCallId) !== Boolean(canonicalLegId)) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_CANONICAL_IDENTITY_INCOMPLETE");
  }
  let directHandoff: RawIdentity["directHandoff"];
  try {
    const identity = hasDirectHandoffIdentity(payload);
    if (Boolean(identity) !== Boolean(event.directHandoffTokenHash)) {
      throw new Error("DIRECT_HANDOFF_IDENTITY_INVALID");
    }
    directHandoff = identity ? { tokenHash: event.directHandoffTokenHash! } : null;
  } catch {
    throw new TelnyxEventOwnerError("TELNYX_DIRECT_HANDOFF_IDENTITY_INVALID");
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

async function persistDirectHandoffOwner(
  tx: OwnerTransaction,
  raw: RawIdentity,
  receivedAt: Date,
) {
  const identity = raw.directHandoff;
  if (!identity) return null;
  if (raw.direction !== "INBOUND" || !raw.providerCallSessionId) {
    throw new TelnyxEventOwnerError("TELNYX_DIRECT_HANDOFF_PROVIDER_IDENTITY_INVALID");
  }

  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_handoff" WHERE "tokenHash" = ${identity.tokenHash} FOR UPDATE`,
  );
  let handoff = await tx.callCenterHandoff.findUnique({
    include: {
      number: { include: { practicePhoneNumber: true } },
      queue: true,
    },
    where: { tokenHash: identity.tokenHash },
  });
  if (!handoff) {
    throw new TelnyxEventOwnerError("TELNYX_DIRECT_HANDOFF_TOKEN_INVALID");
  }
  if (
    handoff.status === "INGRESS_SEEN" &&
    handoff.providerCallSessionId === raw.providerCallSessionId &&
    handoff.callId
  ) {
    return "CANONICAL" as const;
  }
  if (handoff.status !== "ISSUED" || handoff.expiresAt <= receivedAt) {
    throw new TelnyxEventOwnerError("TELNYX_DIRECT_HANDOFF_NOT_TRANSFERABLE");
  }

  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "practice" WHERE "id" = ${handoff.practiceId} FOR SHARE`,
  );
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
    where: { tokenHash: identity.tokenHash },
  });
  if (!handoff) {
    throw new TelnyxEventOwnerError("TELNYX_DIRECT_HANDOFF_ROUTE_CHANGED");
  }
  // ISSUED already authorized the route. Locks protect its tenant boundary;
  // later configuration edits must not reroute or strand an in-flight REFER.
  if (
    handoff.number.practiceId !== handoff.practiceId ||
    handoff.number.practicePhoneNumber.practiceId !== handoff.practiceId ||
    handoff.queue.practiceId !== handoff.practiceId
  ) {
    throw new TelnyxEventOwnerError("TELNYX_DIRECT_HANDOFF_ROUTE_CHANGED");
  }

  const call = await tx.callCenterCall.create({
    data: {
      direction: "INBOUND",
      effectOwner: "CANONICAL",
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
  return "CANONICAL" as const;
}

async function resolveTrustedOutboundIdentity(tx: OwnerTransaction, raw: RawIdentity) {
  if (!raw.canonicalOutboundToken) return raw;
  if (
    !raw.canonicalOutboundPracticeId ||
    (raw.direction !== null && raw.direction !== "OUTBOUND")
  ) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_OUTBOUND_TOKEN_INVALID");
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
    throw new TelnyxEventOwnerError("TELNYX_EVENT_OUTBOUND_TOKEN_NOT_FOUND");
  }
  return { ...raw, canonicalCallId: mapping.aggregateId, canonicalLegId: legId };
}

function assertSameOwner(owners: Array<TelnyxEventOwner | null | undefined>) {
  const known = [...new Set(owners.filter(Boolean))] as TelnyxEventOwner[];
  if (known.length > 1) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_OWNER_CONTRADICTION");
  }
  return known[0] ?? null;
}

async function lockProviderSession(
  tx: OwnerTransaction,
  eventId: string,
  providerCallSessionId: string | null,
) {
  const lockKey = telnyxEventOwnerLockKey(eventId, providerCallSessionId);
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "lock"`,
  );
}

export function telnyxEventOwnerLockKey(
  eventId: string,
  providerCallSessionId: string | null,
) {
  return providerCallSessionId
    ? `TELNYX_SESSION:${providerCallSessionId}`
    : `TELNYX_EVENT:${eventId}`;
}

async function storedSessionOwner(
  tx: OwnerTransaction,
  event: ProviderWebhookRecord,
  providerCallSessionId: string | null,
) {
  if (!providerCallSessionId) return event.effectOwner;
  const rejected = await tx.providerWebhookEvent.findFirst({
    select: { errorCode: true },
    where: {
      errorCode: { startsWith: "TELNYX_DIRECT_HANDOFF_" },
      id: { not: event.id },
      processingStatus: "IGNORED",
      provider: "TELNYX",
      providerCallSessionId,
    },
  });
  if (rejected) {
    throw new TelnyxEventOwnerError("TELNYX_DIRECT_HANDOFF_NOT_TRANSFERABLE");
  }
  const rows = await tx.providerWebhookEvent.findMany({
    distinct: ["effectOwner"],
    orderBy: { receivedAt: "asc" },
    select: { effectOwner: true },
    take: 2,
    where: {
      effectOwner: { not: null },
      provider: "TELNYX",
      providerCallSessionId,
    },
  });
  return assertSameOwner([event.effectOwner, ...rows.map((row) => row.effectOwner)]);
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
    throw new TelnyxEventOwnerError("TELNYX_EVENT_IDENTITY_MISMATCH");
  }
}

const legOwnerSelect = {
  call: { select: { effectOwner: true, id: true, providerCallSessionId: true } },
  id: true,
  kind: true,
  providerCallControlId: true,
  providerCallLegId: true,
  providerCallSessionId: true,
} as const;

async function findAndBindLegIdentity(tx: OwnerTransaction, raw: RawIdentity) {
  const identities = [
    ...(raw.canonicalLegId ? [{ id: raw.canonicalLegId }] : []),
    ...(raw.providerCallControlId
      ? [{ providerCallControlId: raw.providerCallControlId }]
      : []),
    ...(raw.providerCallLegId ? [{ providerCallLegId: raw.providerCallLegId }] : []),
  ];
  if (identities.length === 0) return null;

  const matches = await tx.callCenterCallLeg.findMany({
    select: legOwnerSelect,
    take: 2,
    where: { OR: identities },
  });
  if (matches.length > 1) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_OWNER_AMBIGUOUS");
  }
  const match = matches[0];
  if (!match) return null;

  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "call_center_call_leg" WHERE "id" = ${match.id} FOR UPDATE`,
  );
  const leg = await tx.callCenterCallLeg.findUnique({
    select: legOwnerSelect,
    where: { id: match.id },
  });
  if (!leg) throw new TelnyxEventOwnerError("TELNYX_EVENT_LEG_NOT_FOUND");
  assertLegIdentity(raw, leg);

  try {
    const bound = await tx.callCenterCallLeg.update({
      data: {
        providerCallControlId: leg.providerCallControlId ?? raw.providerCallControlId,
        providerCallLegId: leg.providerCallLegId ?? raw.providerCallLegId,
        providerCallSessionId: leg.providerCallSessionId ?? raw.providerCallSessionId,
      },
      select: legOwnerSelect,
      where: { id: leg.id },
    });
    assertLegIdentity(raw, bound);
    return bound.call.effectOwner;
  } catch (error) {
    if (isRecord(error) && error.code === "P2002") {
      throw new TelnyxEventOwnerError("TELNYX_EVENT_PROVIDER_IDENTITY_CONFLICT");
    }
    throw error;
  }
}

async function findByCustomerSession(tx: OwnerTransaction, raw: RawIdentity) {
  if (!raw.providerCallSessionId) return null;
  const call = await tx.callCenterCall.findUnique({
    select: { effectOwner: true, id: true, providerCallSessionId: true },
    where: { providerCallSessionId: raw.providerCallSessionId },
  });
  if (!call) return null;
  if (raw.canonicalCallId && raw.canonicalCallId !== call.id) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_IDENTITY_MISMATCH");
  }
  return call.effectOwner;
}

async function configuredInboundNumber(tx: OwnerTransaction, toPhone: string) {
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
    throw new TelnyxEventOwnerError("TELNYX_EVENT_NUMBER_OWNER_AMBIGUOUS");
  }
  return numbers[0] ?? null;
}

async function lockPractice(tx: OwnerTransaction, practiceId: string) {
  const practices = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "practice" WHERE "id" = ${practiceId} FOR SHARE
  `);
  if (!practices[0]) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_PRACTICE_NOT_FOUND");
  }
}

async function lockQueue(
  tx: OwnerTransaction,
  queueId: string,
): Promise<{
  enabled: boolean;
  id: string;
  practiceId: string;
  routingMode: "ACTIVE" | "LEGACY" | "SHADOW";
}> {
  const queues = await tx.$queryRaw<
    Array<{
      enabled: boolean;
      id: string;
      practiceId: string;
      routingMode: "ACTIVE" | "LEGACY" | "SHADOW";
    }>
  >(Prisma.sql`
    SELECT "id", "practiceId", "enabled", "routingMode"
    FROM "call_center_queue"
    WHERE "id" = ${queueId}
    FOR SHARE
  `);
  const queue = queues[0];
  if (!queue) throw new TelnyxEventOwnerError("TELNYX_EVENT_QUEUE_NOT_FOUND");
  return queue;
}

async function lockNumber(tx: OwnerTransaction, numberId: string) {
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
  if (!number) throw new TelnyxEventOwnerError("TELNYX_EVENT_NUMBER_NOT_FOUND");
  return number;
}

async function persistInboundOwner(
  tx: OwnerTransaction,
  raw: RawIdentity,
  activationEnabled: boolean,
) {
  if (raw.direction !== "INBOUND") return null;
  if (!raw.providerCallSessionId) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_CALL_SESSION_MISSING");
  }

  const number = await configuredInboundNumber(tx, raw.toPhone);
  if (!number) return "LEGACY" as const;
  if (!number.inboundQueueId) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_NUMBER_QUEUE_MISSING");
  }
  if (!raw.fromPhone) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_CALLER_IDENTITY_MISSING");
  }

  await lockPractice(tx, number.practiceId);
  const queue = await lockQueue(tx, number.inboundQueueId);
  const lockedNumber = await lockNumber(tx, number.id);
  if (!queue.enabled) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_QUEUE_DISABLED");
  }
  if (
    !lockedNumber.enabled ||
    !lockedNumber.inboundEnabled ||
    lockedNumber.inboundQueueId !== queue.id ||
    lockedNumber.practicePhoneNumberId !== number.practicePhoneNumberId ||
    !phoneLookupVariants(raw.toPhone).includes(lockedNumber.phoneNumber)
  ) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_NUMBER_CHANGED");
  }
  if (queue.practiceId !== lockedNumber.practiceId) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_QUEUE_PRACTICE_MISMATCH");
  }

  const effectOwner = ownerForNewAdmission(activationEnabled);
  await tx.callCenterCall.create({
    data: {
      callerName: raw.callerName,
      direction: "INBOUND",
      effectOwner,
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
  return effectOwner;
}

async function persistEventOwner(
  tx: OwnerTransaction,
  event: ProviderWebhookRecord,
  raw: RawIdentity,
  effectOwner: TelnyxEventOwner,
) {
  const assigned = await tx.providerWebhookEvent.updateMany({
    data: {
      effectOwner,
      providerCallSessionId: raw.providerCallSessionId,
    },
    where: {
      attemptCount: event.attemptCount,
      id: event.id,
      OR: [{ effectOwner: null }, { effectOwner }],
      processingStatus: "PROCESSING",
    },
  });
  if (assigned.count !== 1) {
    throw new TelnyxEventOwnerError("TELNYX_EVENT_OWNER_ASSIGNMENT_LOST");
  }
}

/**
 * Selects and commits one provider-effect owner before either effect lane runs.
 * The durable inbox payload is the source of identity, and provider-session
 * serialization keeps unconfigured, legacy, shadow, and active calls sticky
 * across retries, callback reordering, configuration changes, and rollbacks.
 */
export async function resolveTelnyxEventOwner(
  event: ProviderWebhookRecord,
  database: OwnerDatabase = prisma,
  activationConfig: typeof resolveCallCenterActivationConfig = resolveCallCenterActivationConfig,
): Promise<TelnyxEventOwner> {
  const unresolvedRaw = rawIdentity(event);
  return database.$transaction(async (tx) => {
    const ownerTx = tx as OwnerTransaction;
    await lockProviderSession(ownerTx, event.id, unresolvedRaw.providerCallSessionId);
    const raw = await resolveTrustedOutboundIdentity(ownerTx, unresolvedRaw);

    const storedOwner = await storedSessionOwner(
      ownerTx,
      event,
      raw.providerCallSessionId,
    );
    const legOwner = await findAndBindLegIdentity(ownerTx, raw);
    if (!legOwner && raw.canonicalLegId) {
      throw new TelnyxEventOwnerError("TELNYX_EVENT_CANONICAL_IDENTITY_NOT_FOUND");
    }
    const callOwner = await findByCustomerSession(ownerTx, raw);
    const existingOwner = assertSameOwner([storedOwner, legOwner, callOwner]);
    const effectOwner =
      existingOwner ??
      (await persistDirectHandoffOwner(ownerTx, raw, raw.occurredAt)) ??
      (await persistInboundOwner(ownerTx, raw, activationConfig().enabled)) ??
      "LEGACY";

    await persistEventOwner(ownerTx, event, raw, effectOwner);
    return effectOwner;
  });
}
