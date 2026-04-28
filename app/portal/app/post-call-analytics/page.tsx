import { redirect } from "next/navigation";

import { getPortalWorkspaceState } from "@/lib/portal-state";

import PortalModulePlaceholder from "../PortalModulePlaceholder";

export default async function PortalPostCallAnalyticsPage() {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  return (
    <PortalModulePlaceholder
      description="Outcomes should help the practice see front-desk value without exposing raw technical analytics."
      eyebrow="Outcomes"
      primaryActionHref="/portal/app/overview"
      primaryActionLabel="Back to overview"
      queueDescription="The next implementation work for this module."
      queueItems={[
        {
          label: "Booked appointments",
          description:
            "Show who booked, when they booked, and the appointment details staff should verify.",
        },
        {
          label: "Escalations",
          description:
            "Track transfers, callbacks, and unresolved handoffs that need staff follow-up.",
        },
        {
          label: "Practice value",
          description:
            "Track calls handled, peak call times, staff time saved, and call outcomes.",
        },
      ]}
      statusDescription="The route is wired into the live portal. The overview now carries the first live value metrics while this deeper outcomes view is built."
      statusTitle="Outcomes foundation is in place"
      title="Review front-desk outcomes"
    />
  );
}
