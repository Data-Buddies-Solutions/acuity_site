import { redirect } from "next/navigation";

import { getAuthSession } from "@/lib/auth";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import PortalWorkspaceShell from "./PortalWorkspaceShell";

export default async function PortalAppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getAuthSession();

  if (!session) {
    redirect("/portal");
  }

  const portalState = await getPortalWorkspaceState();

  return (
    <PortalWorkspaceShell
      isLive={portalState.launched}
      practiceName={portalState.draft.practiceName}
      userEmail={session.user.email}
    >
      {children}
    </PortalWorkspaceShell>
  );
}
