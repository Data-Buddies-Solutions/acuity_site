import { ApiError, requirePortalCallCenterContext } from "@/lib/api/handler";

import { createTransferAgentHandler, createTransferTargetsHandler } from "./handler";

export const dynamic = "force-dynamic";

async function getActor() {
  const context = await requirePortalCallCenterContext();
  if (!context.session.user.id) throw new ApiError("Unauthorized", 401);
  return {
    allowedLocationIds: context.allowedLocationIds,
    hasAllLocationAccess: context.hasAllLocationAccess,
    practiceId: context.practice.id,
    userId: context.session.user.id,
  };
}

export const GET = createTransferTargetsHandler({ getActor });
export const POST = createTransferAgentHandler({ getActor });
