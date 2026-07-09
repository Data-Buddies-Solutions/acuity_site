import { NextResponse } from "next/server";

import { CallCenterPresenceStatus } from "@/generated/prisma/client";
import {
  parseJsonBody,
  requirePortalCallCenterContext,
  withApiHandler,
} from "@/lib/api/handler";
import { buildCallCenterSeatAccessWhere } from "@/lib/call-center";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set<string>(Object.values(CallCenterPresenceStatus));

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseStatus(value: unknown) {
  const status = asString(value).toUpperCase();

  return VALID_STATUSES.has(status) ? (status as CallCenterPresenceStatus) : null;
}

export const POST = withApiHandler(
  async (request: Request) => {
    const context = await requirePortalCallCenterContext();

    const body = await parseJsonBody(request);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    const browserSessionId = asString(input.browserSessionId);
    const currentSessionId = asString(input.currentSessionId) || null;
    const seatId = asString(input.seatId);
    const status = parseStatus(input.status);

    if (!seatId || !browserSessionId || !status) {
      return NextResponse.json(
        { error: "seatId, browserSessionId, and valid status are required" },
        { status: 400 },
      );
    }

    const seat = await prisma.callCenterAgentSeat.findFirst({
      select: {
        id: true,
      },
      where: {
        enabled: true,
        id: seatId,
        ...buildCallCenterSeatAccessWhere(context),
        practiceId: context.practice.id,
      },
    });

    if (!seat) {
      return NextResponse.json(
        { error: "Call center station not found" },
        { status: 404 },
      );
    }

    const presence = await prisma.callCenterPresence.upsert({
      create: {
        browserSessionId,
        currentSessionId,
        lastSeenAt: new Date(),
        seatId,
        status,
        userId: context.session.user.id,
      },
      select: {
        currentSessionId: true,
        lastSeenAt: true,
        status: true,
      },
      update: {
        currentSessionId,
        lastSeenAt: new Date(),
        status,
        userId: context.session.user.id,
      },
      where: {
        seatId_browserSessionId: {
          browserSessionId,
          seatId,
        },
      },
    });

    return NextResponse.json({ ok: true, presence });
  },
  {
    errorMessage: "Failed to update presence",
    logLabel: "[portal-call-center] Failed to update presence",
  },
);
