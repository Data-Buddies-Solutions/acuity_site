import type { AgentCallEvaluationBucket } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type SetAgentCallEvaluationBucketInput = {
  bucket: AgentCallEvaluationBucket | null;
  callId: string;
  comment?: string | null;
  createdByUserId: string;
  practiceId: string;
};

function normalizeEvaluationComment(comment: string | null | undefined) {
  const normalized = comment?.replace(/\r\n?/g, "\n").trim() ?? "";
  return normalized ? normalized.slice(0, 2000) : null;
}

export async function setAgentCallEvaluationBucket({
  bucket,
  callId,
  comment,
  createdByUserId,
  practiceId,
}: SetAgentCallEvaluationBucketInput) {
  if (!callId || !practiceId) {
    return false;
  }

  return prisma.$transaction(async (tx) => {
    const call = await tx.agentCall.findFirst({
      select: {
        id: true,
        practiceId: true,
      },
      where: {
        practiceId,
        OR: [{ id: callId }, { callId }],
      },
    });

    if (!call) {
      return false;
    }

    await tx.agentCallEvaluationLabel.deleteMany({
      where: {
        callId: call.id,
      },
    });

    if (!bucket) {
      return true;
    }

    await tx.agentCallEvaluationLabel.create({
      data: {
        bucket,
        callId: call.id,
        comment: normalizeEvaluationComment(comment),
        createdByUserId,
        practiceId: call.practiceId,
      },
    });

    return true;
  });
}
