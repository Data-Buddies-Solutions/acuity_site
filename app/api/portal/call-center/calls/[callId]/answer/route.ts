import { ApiError, requirePortalCallCenterContext } from "@/lib/api/handler";

import { createInboundAnswerHandler, createInboundAnswerReleaseHandler } from "./handler";

export const dynamic = "force-dynamic";

const getActor = async () => {
  const context = await requirePortalCallCenterContext();
  if (!context.session.user.id) throw new ApiError("Unauthorized", 401);
  return {
    allowedLocationIds: context.allowedLocationIds,
    hasAllLocationAccess: context.hasAllLocationAccess,
    practiceId: context.practice.id,
    userId: context.session.user.id,
  };
};

export const POST = createInboundAnswerHandler({ getActor });
export const DELETE = createInboundAnswerReleaseHandler({ getActor });
