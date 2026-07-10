import { NextResponse } from "next/server";
import { z } from "zod";

import { CallCenterPresenceStatus } from "@/generated/prisma/client";
import {
  parseJsonBody,
  requirePortalCallCenterContext,
  withApiHandler,
} from "@/lib/api/handler";
import { buildCallCenterSeatAccessWhere } from "@/lib/call-center";
import {
  canWriteLegacyPresence,
  isLegacyPresenceReadyForCalls,
} from "@/lib/call-center/legacy-presence";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const presenceSchema = z
  .object({
    browserSessionId: z.string().trim().min(1, "browserSessionId is required"),
    currentSessionId: z
      .string()
      .trim()
      .optional()
      .transform((value) => value || null),
    readyForCalls: z.boolean().default(false),
    seatId: z.string().trim().min(1, "seatId is required"),
    status: z.preprocess(
      (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
      z.enum(CallCenterPresenceStatus, { error: "A valid status is required" }),
    ),
  })
  .superRefine((presence, context) => {
    if (!canWriteLegacyPresence(presence)) {
      context.addIssue({
        code: "custom",
        message: "AVAILABLE requires an explicitly ready softphone",
        path: ["readyForCalls"],
      });
    }
  });

export const POST = withApiHandler(
  async (request: Request) => {
    const context = await requirePortalCallCenterContext();

    const { browserSessionId, currentSessionId, readyForCalls, seatId, status } =
      await parseJsonBody(request, presenceSchema);
    const persistedReadyForCalls = isLegacyPresenceReadyForCalls({
      readyForCalls,
      status,
    });

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
        readyForCalls: persistedReadyForCalls,
        seatId,
        status,
        userId: context.session.user.id,
      },
      select: {
        currentSessionId: true,
        lastSeenAt: true,
        readyForCalls: true,
        status: true,
      },
      update: {
        currentSessionId,
        lastSeenAt: new Date(),
        readyForCalls: persistedReadyForCalls,
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
