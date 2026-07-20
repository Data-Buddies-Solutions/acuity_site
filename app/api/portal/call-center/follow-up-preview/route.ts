import { requirePortalCallCenterContext } from "@/lib/api/handler";

import {
  createFollowUpPreviewHandler,
  createResolveFollowUpPreviewHandler,
} from "./handler";

export const dynamic = "force-dynamic";

export const GET = createFollowUpPreviewHandler({
  getActor: async () => {
    const context = await requirePortalCallCenterContext();
    return {
      allowedLocationIds: context.allowedLocationIds,
      hasAllLocationAccess: context.hasAllLocationAccess,
      practiceId: context.practice.id,
      userId: context.session.user.id,
    };
  },
});

export const POST = createResolveFollowUpPreviewHandler({
  getActor: async () => {
    const context = await requirePortalCallCenterContext();
    return {
      allowedLocationIds: context.allowedLocationIds,
      hasAllLocationAccess: context.hasAllLocationAccess,
      practiceId: context.practice.id,
      userId: context.session.user.id,
    };
  },
});
