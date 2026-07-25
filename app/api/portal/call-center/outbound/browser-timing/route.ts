import { ApiError, requirePortalCallCenterContext } from "@/lib/api/handler";
import { prisma } from "@/lib/prisma";

import { createOutboundBrowserTimingHandler } from "./handler";

export const dynamic = "force-dynamic";

export const POST = createOutboundBrowserTimingHandler({
  getActor: async () => {
    const context = await requirePortalCallCenterContext();
    if (!context.session.user.id) throw new ApiError("Unauthorized", 401);
    return {
      allowedLocationIds: context.allowedLocationIds,
      hasAllLocationAccess: context.hasAllLocationAccess,
      practiceId: context.practice.id,
      userId: context.session.user.id,
    };
  },
  verifyCall: async (actor, callId) =>
    Boolean(
      await prisma.callCenterCall.findFirst({
        select: { id: true },
        where: { id: callId, practiceId: actor.practiceId },
      }),
    ),
});
