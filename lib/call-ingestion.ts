import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { normalizeLiveKitCallPayload, toJsonCompatible } from "@/lib/call-normalization";
import { shouldQueueAgentCallReview } from "@/lib/call-review/normalize";
import type { CallSummaryData, LiveKitWebhookPayload } from "@/lib/call-types";
import { ESTIMATED_USAGE_PROVIDERS } from "@/lib/pricing";

export class CallIngestionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CallIngestionError";
    this.status = status;
  }
}

function phoneLookupVariants(phone: string) {
  const variants = new Set<string>();
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (trimmed) {
    variants.add(trimmed);
  }

  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
  }

  if (digits.length === 10) {
    variants.add(`+1${digits}`);
    variants.add(`1${digits}`);
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    variants.add(`+${digits}`);
    variants.add(digits.slice(1));
  }

  return [...variants];
}

async function resolvePracticeForCall(input: {
  officePhone: string;
  practiceId: string | null;
}) {
  if (input.practiceId) {
    const practice = await prisma.practice.findUnique({
      select: { id: true },
      where: { id: input.practiceId },
    });

    if (!practice) {
      throw new CallIngestionError("Unknown practiceId", 422);
    }

    const phoneMapping = input.officePhone
      ? await prisma.practicePhoneNumber.findFirst({
          select: { locationId: true, practiceId: true },
          where: {
            phoneNumber: { in: phoneLookupVariants(input.officePhone) },
            practiceId: input.practiceId,
          },
        })
      : null;

    return {
      locationId: phoneMapping?.locationId ?? null,
      practiceId: practice.id,
    };
  }

  if (!input.officePhone) {
    throw new CallIngestionError("Missing officePhone or practiceId", 422);
  }

  const phoneMapping = await prisma.practicePhoneNumber.findFirst({
    select: {
      locationId: true,
      practiceId: true,
    },
    where: {
      phoneNumber: { in: phoneLookupVariants(input.officePhone) },
    },
  });

  if (!phoneMapping) {
    throw new CallIngestionError(
      `No practice phone mapping found for ${input.officePhone}`,
      422,
    );
  }

  return {
    locationId: phoneMapping.locationId,
    practiceId: phoneMapping.practiceId,
  };
}

async function resolveAgentForCall(input: {
  agentId: string | null;
  practiceId: string;
}) {
  if (input.agentId) {
    const agent = await prisma.practiceAgent.findFirst({
      select: { id: true },
      where: {
        id: input.agentId,
        practiceId: input.practiceId,
      },
    });

    if (agent) {
      return agent.id;
    }
  }

  const activeAgent = await prisma.practiceAgent.findFirst({
    orderBy: {
      createdAt: "desc",
    },
    select: { id: true },
    where: {
      practiceId: input.practiceId,
      status: "ACTIVE",
    },
  });

  if (activeAgent) {
    return activeAgent.id;
  }

  const agent = await prisma.practiceAgent.findFirst({
    orderBy: {
      createdAt: "desc",
    },
    select: { id: true },
    where: {
      practiceId: input.practiceId,
    },
  });

  return agent?.id ?? null;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return toJsonCompatible(value) as Prisma.InputJsonValue;
}

function nullableJsonInput(value: unknown) {
  return value == null ? Prisma.JsonNull : jsonInput(value);
}

export async function ingestLiveKitCallPayload(
  body: LiveKitWebhookPayload | CallSummaryData,
) {
  const normalized = normalizeLiveKitCallPayload(body);

  if (!normalized.callId) {
    throw new CallIngestionError("Missing callId");
  }

  const practice = await resolvePracticeForCall({
    officePhone: normalized.officePhone,
    practiceId: normalized.practiceId,
  });
  const agentId = await resolveAgentForCall({
    agentId: normalized.agentId,
    practiceId: practice.practiceId,
  });
  const jsonData = nullableJsonInput(normalized.dataPayload);
  const latencyValues = jsonInput(normalized.latencyValues);
  const reviewResult =
    normalized.reviewResult == null ? undefined : jsonInput(normalized.reviewResult);
  const hasIncomingReview =
    normalized.reviewStatus !== null || normalized.reviewResult !== null;
  const shouldQueueReview =
    !hasIncomingReview &&
    shouldQueueAgentCallReview({
      dataPayload: normalized.dataPayload,
      status: normalized.status,
    });
  const audioData = normalized.audioData ? Buffer.from(normalized.audioData) : null;
  const baseWrite = {
    agentId,
    avgTokensPerSec: normalized.avgTokensPerSec,
    avgTtft: normalized.avgTtft,
    avgTtsttfb: normalized.avgTtsttfb,
    bookedAppointment: normalized.toolActions.bookedAppointment,
    cacheHitRate: normalized.cacheHitRate,
    cachedTokens: normalized.cachedTokens,
    callerPhone: normalized.callerPhone,
    cancelledAppointment: normalized.toolActions.cancelledAppointment,
    confirmedAppointment: normalized.toolActions.confirmedAppointment,
    data: jsonData,
    durationSec: normalized.durationSec,
    endedAt: normalized.endedAt,
    estimatedCostMicros: normalized.estimatedCostMicros,
    fallbackUsed: normalized.fallbackUsed,
    inputTokens: normalized.inputTokens,
    interruptionCount: normalized.interruptionCount,
    latencyValues,
    llmModel: normalized.llmModel,
    locationId: practice.locationId,
    officePhone: normalized.officePhone,
    outcomeSummary: normalized.outcomeSummary,
    outputTokens: normalized.outputTokens,
    peakContext: normalized.peakContext,
    practiceId: practice.practiceId,
    startedAt: normalized.startedAt,
    status: normalized.status,
    toolCalls: normalized.toolCalls,
    toolErrors: normalized.toolErrors,
    totalTurns: normalized.totalTurns,
    transferred: normalized.toolActions.transferred,
    ttsChars: normalized.ttsChars,
  };
  const reviewCreateWrite = {
    needsReview: normalized.needsReview,
    reviewAverageScore: hasIncomingReview ? normalized.reviewAverageScore : null,
    reviewStatus: hasIncomingReview
      ? normalized.reviewStatus
      : shouldQueueReview
        ? "pending"
        : null,
    ...(hasIncomingReview && reviewResult !== undefined ? { reviewResult } : {}),
  };
  const reviewUpdateWrite = hasIncomingReview
    ? {
        needsReview: normalized.needsReview,
        reviewAverageScore: normalized.reviewAverageScore,
        reviewStatus: normalized.reviewStatus,
        ...(reviewResult === undefined ? {} : { reviewResult }),
      }
    : {};
  const updateWrite = {
    ...baseWrite,
    ...reviewUpdateWrite,
    ...(audioData ? { audioData } : {}),
  };
  const createWrite = {
    ...baseWrite,
    ...reviewCreateWrite,
    audioData,
    callId: normalized.callId,
  };

  const stored = await prisma.$transaction(async (tx) => {
    const existing = await tx.agentCall.findUnique({
      select: { reviewStatus: true },
      where: { callId: normalized.callId },
    });

    let agentCall = await tx.agentCall.upsert({
      create: createWrite,
      update: updateWrite,
      where: {
        callId: normalized.callId,
      },
    });

    if (!hasIncomingReview && shouldQueueReview && existing && !existing.reviewStatus) {
      agentCall = await tx.agentCall.update({
        data: {
          needsReview: normalized.needsReview,
          reviewStatus: "pending",
        },
        where: { id: agentCall.id },
      });
    }

    await tx.usageCostLineItem.deleteMany({
      where: {
        agentCallId: agentCall.id,
        provider: {
          in: [...ESTIMATED_USAGE_PROVIDERS],
        },
      },
    });

    if (normalized.costItems.length > 0) {
      await tx.usageCostLineItem.createMany({
        data: normalized.costItems.map((item) => ({
          agentCallId: agentCall.id,
          category: item.category,
          costMicros: item.costMicros,
          metadata: jsonInput({ source: "livekit-forward-sync" }),
          model: item.model,
          occurredAt: normalized.startedAt,
          practiceId: practice.practiceId,
          provider: item.provider,
          quantity: item.quantity,
          unit: item.unit,
        })),
      });
    }

    return agentCall;
  });

  return {
    agentCallId: stored.id,
    callId: stored.callId,
    practiceId: stored.practiceId,
    status: stored.status,
  };
}
