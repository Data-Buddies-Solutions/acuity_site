import { after } from "next/server";

import { ApiError, requirePortalCallCenterContext } from "@/lib/api/handler";
import { scheduleImmediateProviderCommand } from "@/lib/call-center/application/schedule-provider-command";

import { createClaimCallHandler } from "./handler";

export const dynamic = "force-dynamic";

const POST = createClaimCallHandler({
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
  scheduleCommand: (commandId) => {
    scheduleImmediateProviderCommand(commandId, after);
  },
});

export { POST };
