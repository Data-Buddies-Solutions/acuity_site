import { requirePortalCallCenterContext, withApiHandler } from "@/lib/api/handler";

import { createSnapshotHandler } from "./handler";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(
  createSnapshotHandler({
    getActor: async () => {
      const context = await requirePortalCallCenterContext();
      return {
        allowedLocationIds: context.allowedLocationIds,
        hasAllLocationAccess: context.hasAllLocationAccess,
        practiceId: context.practice.id,
        userId: context.session.user.id,
      };
    },
  }),
  {
    errorMessage: "Failed to load call center snapshot",
    logLabel: "[portal-call-center] Failed to load canonical snapshot",
  },
);
