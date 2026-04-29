import { redirect } from "next/navigation";

import { getPortalWorkspaceState } from "@/lib/portal-state";

export default async function PortalTwoWayTextingPage() {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#6a7b7e]">
        Coming soon
      </p>
      <h1 className="text-3xl font-semibold tracking-[-0.04em] text-[#10272c] md:text-4xl">
        Patient Engagement
      </h1>
      <p className="max-w-2xl text-base leading-7 text-[#617477]">
        Two-way texting and patient engagement workflows are coming soon, giving staff a
        simple place to review replies, follow-ups, and conversations that need attention.
      </p>
    </div>
  );
}
