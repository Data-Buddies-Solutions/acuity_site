import { redirect } from "next/navigation";

import { getPortalWorkspaceState } from "@/lib/portal-state";

import PreparingReceptionist from "./PreparingReceptionist";

export default async function PortalPreparingPage() {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched && process.env.NODE_ENV !== "development") {
    redirect("/portal/app/onboarding");
  }

  return <PreparingReceptionist />;
}
