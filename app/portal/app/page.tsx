import { redirect } from "next/navigation";

import { getPortalWorkspaceState } from "@/lib/portal-state";

export default async function PortalAppPage() {
  const portalState = await getPortalWorkspaceState();

  redirect(portalState.launched ? "/portal/app/overview" : "/portal/app/onboarding");
}
