import { redirect } from "next/navigation";

import { getPortalWorkspaceState } from "@/lib/portal-state";

import PortalModulePlaceholder from "../PortalModulePlaceholder";

export default async function PortalTwoWayTextingPage() {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  return (
    <PortalModulePlaceholder
      description="Two-way texting should become the review surface for patient replies, follow-ups, and conversations the agent could not close automatically."
      eyebrow="Two-way Texting"
      primaryActionHref="/portal/app/overview"
      primaryActionLabel="Back to overview"
      queueDescription="The next implementation work for this module."
      queueItems={[
        {
          label: "Inbox view",
          description:
            "Group unread patient replies, pending responses, and threads that need escalation.",
        },
        {
          label: "Conversation history",
          description:
            "Show the full message timeline with delivery state and handoff context.",
        },
        {
          label: "Staff actions",
          description:
            "Allow reply, assign, snooze, or escalate actions without leaving the thread.",
        },
      ]}
      statusDescription="The route exists and the portal recognizes it as a live module, but messaging data is not connected yet."
      statusTitle="Texting foundation is in place"
      title="Handle patient message follow-up"
    />
  );
}
