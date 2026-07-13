import { redirect } from "next/navigation";

import { getAuthSession } from "@/lib/auth";
import { getPortalBookings } from "@/lib/portal-overview";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { getPortalTasks, portalTaskCategories } from "@/lib/portal-tasks";

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
  const [latestBookings, taskState] = portalState.launched
    ? await Promise.all([
        getPortalBookings("all", 10),
        getPortalTasks({
          category: "all",
          office: null,
          priority: "all",
          status: "in_progress",
        }),
      ])
    : [null, null];
  const inProgressTaskCount = taskState
    ? portalTaskCategories.reduce(
        (total, category) => total + taskState.tasksByCategory[category].length,
        0,
      )
    : 0;

  return (
    <PortalWorkspaceShell
      isLive={portalState.launched}
      latestBookingAt={latestBookings?.bookings[0]?.callStartedAt.toISOString() ?? null}
      outstandingTaskCount={(taskState?.totalOpenTasks ?? 0) + inProgressTaskCount}
      practiceBranding={portalState.branding}
      practiceName={portalState.draft.practiceName}
      userEmail={session.user.email}
    >
      {children}
    </PortalWorkspaceShell>
  );
}
