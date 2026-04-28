import { redirect } from "next/navigation";

import { getPortalWorkspaceState } from "@/lib/portal-state";

import PortalModulePlaceholder from "../PortalModulePlaceholder";

export default async function PortalTaskingPage() {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  return (
    <PortalModulePlaceholder
      description="Tasking should collect everything the AI could not close itself so front-desk staff have a clear work queue after calls and texts."
      eyebrow="Tasking"
      primaryActionHref="/portal/app/overview"
      primaryActionLabel="Back to overview"
      queueDescription="The next implementation work for this module."
      queueItems={[
        {
          label: "Action queue",
          description:
            "Show every open task with owner, due time, source conversation, and status.",
        },
        {
          label: "Task detail",
          description:
            "Open the patient context, transcript, and the exact reason the AI created the task.",
        },
        {
          label: "Workflow updates",
          description:
            "Support assign, complete, reopen, and escalate actions from inside the portal.",
        },
      ]}
      statusDescription="The route is real and ready for wiring, but task records are not persisted yet."
      statusTitle="Tasking foundation is in place"
      title="Track human follow-up work"
    />
  );
}
