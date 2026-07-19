import { redirect } from "next/navigation";

import { getAuthSession } from "@/lib/auth";
import { getPortalShellState } from "@/lib/portal-state";

import PortalWorkspaceShell from "./PortalWorkspaceShell";
import { SoftphoneRuntime } from "./SoftphoneRuntime";

export default async function PortalAppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getAuthSession();

  if (!session) {
    redirect("/portal");
  }

  const portalState = await getPortalShellState();

  return (
    <SoftphoneRuntime>
      <PortalWorkspaceShell
        isLive={portalState.launched}
        practiceBranding={portalState.branding}
        practiceName={portalState.practiceName}
        userEmail={session.user.email}
      >
        {children}
      </PortalWorkspaceShell>
    </SoftphoneRuntime>
  );
}
