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
      description="Post-call analytics should help the practice audit what happened, where automation is succeeding, and where workflows still need tuning."
      eyebrow="Post-call Analytics"
      primaryActionHref="/portal/app/overview"
      primaryActionLabel="Back to overview"
      queueDescription="The next implementation work for this module."
      queueItems={[
        {
          label: "Call outcomes",
          description: "Break down completed calls by intent, resolution path, and escalation rate.",
        },
        {
          label: "Quality review",
          description: "Surface transcripts and flagged interactions for QA and workflow tuning.",
        },
        {
          label: "Trend reporting",
          description: "Track call volume, booking results, and repeat pain points over time.",
        },
      ]}
      statusDescription="The route is wired into the live portal, but production reporting is not connected yet."
      statusTitle="Analytics foundation is in place"
      title="Audit performance after launch"
    />
  );
}
