import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { callNeedsReview, getReviewAverageScore } from "@/lib/call-normalization";
import { runCodexCallReview } from "@/lib/call-review/codex";
import { deriveDeterministicFindings } from "@/lib/call-review/deterministic";
import {
  buildNormalizedReviewInputFromAgentCall,
  hasReviewMaterial,
  type AgentCallReviewSource,
} from "@/lib/call-review/normalize";
import { CALL_REVIEW_JUDGE_VERSION } from "@/lib/call-review/types";

const REVIEW_CALL_SELECT = {
  bookedAppointment: true,
  callId: true,
  callerPhone: true,
  cancelledAppointment: true,
  confirmedAppointment: true,
  data: true,
  durationSec: true,
  endedAt: true,
  fallbackUsed: true,
  id: true,
  interruptionCount: true,
  officePhone: true,
  reviewStatus: true,
  startedAt: true,
  status: true,
  toolCalls: true,
  toolErrors: true,
  totalTurns: true,
  transferred: true,
  updatedAt: true,
} as const;

type ReviewAgentCallRow = AgentCallReviewSource & {
  reviewStatus: string | null;
  updatedAt: Date;
};

export type AgentCallReviewRunResult = {
  agentCallId: string;
  callId: string;
  ok: boolean;
  reviewStatus: "completed" | "failed" | "skipped";
  error?: string;
};

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 4000);
}

function toReviewSource(call: ReviewAgentCallRow): AgentCallReviewSource {
  return {
    bookedAppointment: call.bookedAppointment,
    callId: call.callId,
    callerPhone: call.callerPhone,
    cancelledAppointment: call.cancelledAppointment,
    confirmedAppointment: call.confirmedAppointment,
    data: call.data,
    durationSec: call.durationSec,
    endedAt: call.endedAt,
    fallbackUsed: call.fallbackUsed,
    id: call.id,
    interruptionCount: call.interruptionCount,
    officePhone: call.officePhone,
    startedAt: call.startedAt,
    status: call.status,
    toolCalls: call.toolCalls,
    toolErrors: call.toolErrors,
    totalTurns: call.totalTurns,
    transferred: call.transferred,
  };
}

async function findAgentCallForReviewById(id: string) {
  return prisma.agentCall.findUnique({
    select: REVIEW_CALL_SELECT,
    where: { id },
  }) as Promise<ReviewAgentCallRow | null>;
}

async function writeReviewFailure(call: ReviewAgentCallRow, error: unknown) {
  const message = errorMessage(error);
  await prisma.agentCall.update({
    data: {
      needsReview: true,
      reviewAverageScore: null,
      reviewResult: jsonInput({
        failedAt: new Date().toISOString(),
        judgeVersion: CALL_REVIEW_JUDGE_VERSION,
        reviewError: { message },
        reviewHarness: CALL_REVIEW_JUDGE_VERSION,
      }),
      reviewStatus: "failed",
    },
    where: { id: call.id },
  });
  return message;
}

async function processClaimedAgentCallReview(
  call: ReviewAgentCallRow,
): Promise<AgentCallReviewRunResult> {
  try {
    const baseInput = buildNormalizedReviewInputFromAgentCall(toReviewSource(call));
    if (!hasReviewMaterial(baseInput)) {
      throw new Error("Call has no transcript, tool events, or tool execution material");
    }

    const deterministicFindings = deriveDeterministicFindings(baseInput);
    const input = buildNormalizedReviewInputFromAgentCall(
      toReviewSource(call),
      deterministicFindings,
    );
    const judged = await runCodexCallReview(input);
    const storedResult = {
      ...judged.result,
      deterministicFindings,
      deterministicFlags: deterministicFindings.map((finding) => finding.flag),
      judgeModel: judged.judgeModel,
      judgeVersion: judged.judgeVersion,
      reviewHarness: CALL_REVIEW_JUDGE_VERSION,
      reviewedAt: new Date().toISOString(),
    };

    await prisma.agentCall.update({
      data: {
        needsReview: callNeedsReview({
          reviewResult: storedResult,
          reviewStatus: "completed",
          toolErrors: call.toolErrors,
        }),
        reviewAverageScore: getReviewAverageScore(storedResult),
        reviewResult: jsonInput(storedResult),
        reviewStatus: "completed",
      },
      where: { id: call.id },
    });

    return {
      agentCallId: call.id,
      callId: call.callId,
      ok: true,
      reviewStatus: "completed",
    };
  } catch (error) {
    const message = await writeReviewFailure(call, error);
    return {
      agentCallId: call.id,
      callId: call.callId,
      error: message,
      ok: false,
      reviewStatus: "failed",
    };
  }
}

export async function resetStaleRunningAgentCallReviews(minutes = 30) {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  const result = await prisma.agentCall.updateMany({
    data: { reviewStatus: "pending" },
    where: {
      reviewStatus: "running",
      updatedAt: { lt: cutoff },
    },
  });

  return result.count;
}

export async function claimNextPendingAgentCallReview() {
  const candidate = (await prisma.agentCall.findFirst({
    orderBy: [{ endedAt: "desc" }, { startedAt: "desc" }],
    select: REVIEW_CALL_SELECT,
    where: {
      reviewStatus: "pending",
      status: { not: "IN_PROGRESS" },
    },
  })) as ReviewAgentCallRow | null;

  if (!candidate) {
    return null;
  }

  const claimed = await prisma.agentCall.updateMany({
    data: {
      reviewStatus: "running",
    },
    where: {
      id: candidate.id,
      reviewStatus: "pending",
    },
  });

  if (claimed.count !== 1) {
    return null;
  }

  return findAgentCallForReviewById(candidate.id);
}

export async function processPendingAgentCallReviews(limit = 10) {
  const results: AgentCallReviewRunResult[] = [];

  for (let index = 0; index < limit; index++) {
    const call = await claimNextPendingAgentCallReview();
    if (!call) {
      break;
    }

    results.push(await processClaimedAgentCallReview(call));
  }

  return results;
}

export async function processAgentCallReviewByCallId(
  callId: string,
  options: { force?: boolean } = {},
): Promise<AgentCallReviewRunResult> {
  const call = (await prisma.agentCall.findUnique({
    select: REVIEW_CALL_SELECT,
    where: { callId },
  })) as ReviewAgentCallRow | null;

  if (!call) {
    throw new Error(`AgentCall not found for callId ${callId}`);
  }

  if (call.reviewStatus === "completed" && !options.force) {
    return {
      agentCallId: call.id,
      callId: call.callId,
      ok: true,
      reviewStatus: "skipped",
    };
  }

  await prisma.agentCall.update({
    data: {
      reviewAverageScore: null,
      reviewResult: Prisma.JsonNull,
      reviewStatus: "running",
    },
    where: { id: call.id },
  });

  const claimed = await findAgentCallForReviewById(call.id);
  if (!claimed) {
    throw new Error(`AgentCall disappeared during review claim for callId ${callId}`);
  }

  return processClaimedAgentCallReview(claimed);
}
