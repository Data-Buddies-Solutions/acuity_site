"use server";

import { revalidatePath } from "next/cache";

import { createCallCenterActionHandlers } from "@/app/portal/app/call-center/action-handlers";
import { operatorFollowUp } from "@/lib/call-center/operator-follow-up-runtime";
import { reportCallCenterError } from "@/lib/call-center/operator-error-response";
import { getCurrentPortalPracticeContext } from "@/lib/portal-access";

const CALL_CENTER_MUTATION_ERROR = "Call center action could not be completed";

const actions = createCallCenterActionHandlers({
  followUp: operatorFollowUp,
  getContext: getCurrentPortalPracticeContext,
  reportError: (error) => {
    reportCallCenterError(error, undefined, {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "save call center note failed",
      retryable: true,
    });
  },
  revalidate: revalidatePath,
});

export async function resolveNeedsActionGroupAction(formData: FormData) {
  await actions.resolveNeedsActionGroup(formData);
}

export async function saveCallCenterNoteFormAction(formData: FormData) {
  const result = await actions.saveCallCenterNote(formData);
  if (!result.ok) throw new Error(CALL_CENTER_MUTATION_ERROR);
}
