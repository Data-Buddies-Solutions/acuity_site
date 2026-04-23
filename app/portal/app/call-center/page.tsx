import { redirect } from "next/navigation";

import { getPortalWorkspaceState } from "@/lib/portal-state";

import PortalModulePlaceholder from "../PortalModulePlaceholder";

export default async function PortalCallCenterPage() {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  return (
    <PortalModulePlaceholder
      description="The call center module should become the live queue for escalations, callbacks, and conversations that need staff attention."
      eyebrow="Call Center"
      primaryActionHref="/portal/app/overview"
      primaryActionLabel="Back to overview"
      queueDescription="The next implementation work for this module."
      queueItems={[
        {
          label: "Live queue",
          description: "Show active escalations, missed callbacks, and handoffs that need ownership.",
        },
        {
          label: "Conversation detail",
          description: "Open a call record with transcript, intent, and transfer context for staff review.",
        },
        {
          label: "Resolution actions",
          description: "Let staff resolve, reassign, or escalate items directly from the queue.",
        },
      ]}
      statusDescription="The route is live and the nav item is real, but telephony data is not wired in yet."
      statusTitle="Call center foundation is in place"
      title="Review calls that need staff follow-up"
    />
  );
}
