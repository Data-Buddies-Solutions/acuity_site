import type { AgentCallEvaluationBucket } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type SetAgentCallEvaluationBucketInput = {
  bucket: AgentCallEvaluationBucket | null;
  callId: string;
  createdByUserId: string;
  practiceId: string;
};

export async function setAgentCallEvaluationBucket({
  bucket,
  callId,
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
        createdByUserId,
        practiceId: call.practiceId,
      },
    });

    return true;
  });
}
