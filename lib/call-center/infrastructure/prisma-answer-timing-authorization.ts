import { prisma } from "@/lib/prisma";

type AnswerTimingActor = { practiceId: string; userId: string };
type AnswerTimingIdentity = {
  agentSessionId: string;
  callId: string;
  callLegId: string;
};

export async function authorizeAnswerTimingIdentity(
  actor: AnswerTimingActor,
  identity: AnswerTimingIdentity,
) {
  const session = await prisma.callCenterAgentSession.findFirst({
    select: { id: true },
    where: {
      callLegs: {
        some: {
          call: { practiceId: actor.practiceId },
          callId: identity.callId,
          id: identity.callLegId,
        },
      },
      id: identity.agentSessionId,
      practiceId: actor.practiceId,
      userId: actor.userId,
    },
  });
  return Boolean(session);
}
