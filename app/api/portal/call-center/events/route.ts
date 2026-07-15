import { requirePortalCallCenterContext } from "@/lib/api/handler";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

import { createCanonicalEventsHandler } from "./canonical-handler";

export const dynamic = "force-dynamic";

export const GET = withCallCenterApiHandler(
  createCanonicalEventsHandler({
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
    errorCode: "TEMPORARY_SERVICE_FAILURE",
    logLabel: "[portal-call-center] Failed to stream call center events",
    retryable: true,
  },
);
