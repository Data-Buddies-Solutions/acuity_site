import { requirePortalCallCenterContext } from "@/lib/api/handler";
import { operatorFollowUp } from "@/lib/call-center/operator-follow-up-runtime";

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
  followUp: operatorFollowUp,
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
