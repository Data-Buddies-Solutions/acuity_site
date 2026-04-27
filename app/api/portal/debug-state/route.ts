import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { hasPracticeWorkspaceTables } from "@/lib/practice-workspace";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await getAuthSession();
  const workspaceTablesAvailable = await hasPracticeWorkspaceTables();
  const portalState = await getPortalWorkspaceState();
  const membership = session
    ? await prisma.practiceMembership.findFirst({
        include: {
          practice: {
            select: {
              id: true,
              launchedAt: true,
              name: true,
              onboardingStatus: true,
            },
          },
        },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        where: {
          userId: session.user.id,
        },
      })
    : null;

  return NextResponse.json({
    portalState: {
      launched: portalState.launched,
      missingSections: portalState.missingSections.map((section) => section.key),
      readyToLaunch: portalState.readyToLaunch,
    },
    practice: membership?.practice ?? null,
    session: session
      ? {
          email: session.user.email,
          id: session.user.id,
        }
      : null,
    workspaceTablesAvailable,
  });
}
