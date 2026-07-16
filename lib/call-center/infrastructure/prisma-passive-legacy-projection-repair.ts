import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import {
  CANONICAL_PROJECTION_MAX_ATTEMPTS,
  PASSIVE_LEGACY_OUT_OF_SCOPE_CODE,
} from "@/lib/call-center/infrastructure/canonical-provider-webhook-inbox";
import { parseCanonicalTelnyxCallFact } from "@/lib/call-center/infrastructure/telnyx-canonical-call-fact";
import { phoneLookupVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

const REPAIR_EVENT_TYPE = "CALL_CENTER_PROJECTION_HISTORY_REPAIRED";
const allowedFailureCodes = new Set([
  "CANONICAL_NUMBER_NOT_FOUND",
  "CANONICAL_CALL_NOT_FOUND",
  "CANONICAL_LEG_CONTEXT_MISSING",
]);
const terminalMainStatuses = new Set(["IGNORED", "PROCESSED"]);
const terminalProjectionStatuses = new Set(["FAILED", "IGNORED", "PROCESSED"]);

type RepairInput = {
  practiceId: string;
  providerCallSessionId: string;
};

type RepairRow = {
  canonicalProjectionAttemptCount: number;
  canonicalProjectionErrorCode: string | null;
  canonicalProjectionStatus: string;
  effectOwner: "CANONICAL" | "LEGACY" | null;
  eventType: string;
  id: string;
  payload: unknown;
  processingStatus: string;
  providerCallSessionId: string | null;
  receivedAt: Date;
};

type RepairTransaction = Pick<
  Prisma.TransactionClient,
  | "$queryRaw"
  | "callCenterCall"
  | "callCenterCallLeg"
  | "callCenterNumber"
  | "callCenterEvent"
  | "practicePhoneNumber"
  | "providerWebhookEvent"
>;

export class PassiveLegacyProjectionRepairError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PassiveLegacyProjectionRepairError";
  }
}

function fail(code: string): never {
  throw new PassiveLegacyProjectionRepairError(code);
}

function sessionDigest(providerCallSessionId: string) {
  return createHash("sha256").update(providerCallSessionId).digest("hex");
}

function receiptCount(data: Prisma.JsonValue) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail("PASSIVE_LEGACY_REPAIR_RECEIPT_INVALID");
  }
  const count = data.repairedCount;
  if (!Number.isSafeInteger(count) || Number(count) < 1) {
    fail("PASSIVE_LEGACY_REPAIR_RECEIPT_INVALID");
  }
  return Number(count);
}

function validateRows(rows: RepairRow[], input: RepairInput) {
  if (!rows.length) fail("PASSIVE_LEGACY_REPAIR_SESSION_NOT_FOUND");
  if (
    rows.some(
      (row) =>
        row.providerCallSessionId !== input.providerCallSessionId ||
        row.effectOwner !== "LEGACY" ||
        !terminalMainStatuses.has(row.processingStatus) ||
        !terminalProjectionStatuses.has(row.canonicalProjectionStatus),
    )
  ) {
    fail("PASSIVE_LEGACY_REPAIR_SESSION_INELIGIBLE");
  }

  const failures = rows.filter(
    ({ canonicalProjectionStatus }) => canonicalProjectionStatus === "FAILED",
  );
  if (
    !failures.length ||
    failures.some(
      (row) =>
        row.canonicalProjectionAttemptCount < CANONICAL_PROJECTION_MAX_ATTEMPTS ||
        !row.canonicalProjectionErrorCode ||
        !allowedFailureCodes.has(row.canonicalProjectionErrorCode),
    )
  ) {
    fail("PASSIVE_LEGACY_REPAIR_FAILURE_INELIGIBLE");
  }

  const proofs = failures.filter(
    (row) =>
      row.eventType === "call.initiated" &&
      row.canonicalProjectionErrorCode === "CANONICAL_NUMBER_NOT_FOUND",
  );
  if (!proofs.length) fail("PASSIVE_LEGACY_REPAIR_PROOF_MISSING");
  return { failures, proofs };
}

async function proveSinglePractice(
  tx: RepairTransaction,
  proofs: RepairRow[],
  input: RepairInput,
) {
  const proofNumbers = proofs.map((row) => {
    let fact: ReturnType<typeof parseCanonicalTelnyxCallFact>;
    try {
      fact = parseCanonicalTelnyxCallFact(row.payload, row.receivedAt);
    } catch {
      fail("PASSIVE_LEGACY_REPAIR_PROOF_INVALID");
    }
    if (
      !fact ||
      fact.eventType !== "call.initiated" ||
      fact.providerCallSessionId !== input.providerCallSessionId ||
      !fact.direction
    ) {
      fail("PASSIVE_LEGACY_REPAIR_PROOF_INVALID");
    }
    const phone = fact.direction === "INBOUND" ? fact.toPhone : fact.fromPhone;
    if (!phone) fail("PASSIVE_LEGACY_REPAIR_PROOF_INVALID");
    return { direction: fact.direction, phone };
  });
  const practicePhones = proofNumbers.map(({ phone }) => phone);
  const numbers = await tx.practicePhoneNumber.findMany({
    select: { phoneNumber: true, practiceId: true },
    where: {
      phoneNumber: {
        in: [...new Set(practicePhones.flatMap(phoneLookupVariants))],
      },
    },
  });
  const everyProofMatchesPractice = practicePhones.every((phone) => {
    const matches = numbers.filter(({ phoneNumber }) =>
      phoneLookupVariants(phone).includes(phoneNumber),
    );
    return matches.length === 1 && matches[0]?.practiceId === input.practiceId;
  });
  if (!everyProofMatchesPractice) {
    fail("PASSIVE_LEGACY_REPAIR_PRACTICE_UNPROVEN");
  }

  const inboundPhones = proofNumbers
    .filter(({ direction }) => direction === "INBOUND")
    .flatMap(({ phone }) => phoneLookupVariants(phone));
  const outboundPhones = proofNumbers
    .filter(({ direction }) => direction === "OUTBOUND")
    .flatMap(({ phone }) => phoneLookupVariants(phone));
  const directionScope = [
    ...(inboundPhones.length
      ? [
          {
            inboundEnabled: true,
            practicePhoneNumber: { phoneNumber: { in: [...new Set(inboundPhones)] } },
          },
        ]
      : []),
    ...(outboundPhones.length
      ? [
          {
            outboundEnabled: true,
            practicePhoneNumber: { phoneNumber: { in: [...new Set(outboundPhones)] } },
          },
        ]
      : []),
  ];
  const configuredNumberCount = await tx.callCenterNumber.count({
    where: {
      enabled: true,
      OR: directionScope,
      practiceId: input.practiceId,
    },
  });
  if (configuredNumberCount) {
    fail("PASSIVE_LEGACY_REPAIR_NUMBER_NOW_CONFIGURED");
  }
}

export async function repairExhaustedLegacyOutOfScopeSessionInTransaction(
  tx: RepairTransaction,
  input: RepairInput,
  now: Date,
) {
  const digest = sessionDigest(input.providerCallSessionId);
  const idempotencyKey = `passive-legacy-out-of-scope:${digest}`;
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))::text AS "lock"`,
  );

  const existingReceipt = await tx.callCenterEvent.findUnique({
    select: { data: true, revision: true },
    where: {
      practiceId_type_idempotencyKey: {
        idempotencyKey,
        practiceId: input.practiceId,
        type: REPAIR_EVENT_TYPE,
      },
    },
  });
  if (existingReceipt) {
    return {
      outcome: "ALREADY_REPAIRED" as const,
      repairedCount: receiptCount(existingReceipt.data),
      revision: existingReceipt.revision,
    };
  }

  await tx.$queryRaw(
    Prisma.sql`
      SELECT "id"
      FROM "provider_webhook_event"
      WHERE "provider" = CAST('TELNYX' AS "CallCenterProvider")
        AND "providerCallSessionId" = ${input.providerCallSessionId}
      FOR UPDATE
    `,
  );
  const rows = (await tx.providerWebhookEvent.findMany({
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    select: {
      canonicalProjectionAttemptCount: true,
      canonicalProjectionErrorCode: true,
      canonicalProjectionStatus: true,
      effectOwner: true,
      eventType: true,
      id: true,
      payload: true,
      processingStatus: true,
      providerCallSessionId: true,
      receivedAt: true,
    },
    where: {
      provider: "TELNYX",
      providerCallSessionId: input.providerCallSessionId,
    },
  })) as RepairRow[];
  const { failures, proofs } = validateRows(rows, input);

  const callCount = await tx.callCenterCall.count({
    where: { providerCallSessionId: input.providerCallSessionId },
  });
  const legCount = await tx.callCenterCallLeg.count({
    where: { providerCallSessionId: input.providerCallSessionId },
  });
  if (callCount || legCount) fail("PASSIVE_LEGACY_REPAIR_CORRELATION_EXISTS");
  await proveSinglePractice(tx, proofs, input);

  const repaired = await tx.providerWebhookEvent.updateMany({
    data: {
      canonicalProjectedAt: now,
      canonicalProjectionErrorCode: PASSIVE_LEGACY_OUT_OF_SCOPE_CODE,
      canonicalProjectionNextAttemptAt: null,
      canonicalProjectionStatus: "IGNORED",
    },
    where: {
      effectOwner: "LEGACY",
      processingStatus: { in: ["PROCESSED", "IGNORED"] },
      provider: "TELNYX",
      providerCallSessionId: input.providerCallSessionId,
      OR: failures.map((row) => ({
        canonicalProjectionAttemptCount: row.canonicalProjectionAttemptCount,
        canonicalProjectionErrorCode: row.canonicalProjectionErrorCode,
        canonicalProjectionStatus: "FAILED" as const,
        id: row.id,
      })),
    },
  });
  if (repaired.count !== failures.length) {
    fail("PASSIVE_LEGACY_REPAIR_CAS_LOST");
  }

  const receipt = await tx.callCenterEvent.create({
    data: {
      aggregateId: input.practiceId,
      aggregateType: "CONFIGURATION",
      data: {
        failureCodes: [
          ...new Set(failures.map((row) => row.canonicalProjectionErrorCode)),
        ],
        proofCount: proofs.length,
        repairedCount: failures.length,
        status: "IGNORED",
      },
      idempotencyKey,
      occurredAt: now,
      practiceId: input.practiceId,
      type: REPAIR_EVENT_TYPE,
    },
    select: { revision: true },
  });
  return {
    outcome: "REPAIRED" as const,
    repairedCount: failures.length,
    revision: receipt.revision,
  };
}

export async function repairExhaustedLegacyOutOfScopeSession(
  input: RepairInput,
  now = new Date(),
) {
  return prisma.$transaction((tx) =>
    repairExhaustedLegacyOutOfScopeSessionInTransaction(tx, input, now),
  );
}
