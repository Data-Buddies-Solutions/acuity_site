import { ApiError, requirePortalCallCenterContext } from "@/lib/api/handler";
import { authorizeAnswerTimingIdentity } from "@/lib/call-center/infrastructure/prisma-answer-timing-authorization";

import { createAnswerTimingHandler } from "./handler";

export const dynamic = "force-dynamic";

export const POST = createAnswerTimingHandler({
  authorize: authorizeAnswerTimingIdentity,
  getActor: async () => {
    const context = await requirePortalCallCenterContext();
    if (!context.session.user.id) throw new ApiError("Unauthorized", 401);
    return {
      practiceId: context.practice.id,
      userId: context.session.user.id,
    };
  },
});
