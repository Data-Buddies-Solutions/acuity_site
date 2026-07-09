import { NextResponse } from "next/server";

import { requirePortalCallCenterContext, withApiHandler } from "@/lib/api/handler";
import {
  allowsSharedCallCenterStation,
  buildCallCenterSeatAccessWhere,
  getAllowedCallCenterOutboundPhoneNumbers,
  getPresenceExpirationCutoff,
  resolveTelnyxRuntimeSettings,
} from "@/lib/call-center";
import { createTelnyxLoginToken } from "@/lib/telnyx";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export const GET = withApiHandler(
  async (request: Request) => {
    const context = await requirePortalCallCenterContext();
    const settings = context.practice.callCenterSettings;

    const runtimeSettings = resolveTelnyxRuntimeSettings(settings);
    const url = new URL(request.url);
    const browserSessionId = url.searchParams.get("browserSessionId")?.trim() || "";
    const seatId = url.searchParams.get("seatId")?.trim() || "";
    const seat = seatId
      ? await prisma.callCenterAgentSeat.findFirst({
          select: {
            id: true,
            label: true,
            queueKey: true,
            telnyxCredentialId: true,
          },
          where: {
            enabled: true,
            id: seatId,
            ...buildCallCenterSeatAccessWhere(context),
            practiceId: context.practice.id,
          },
        })
      : null;

    if (seatId && !seat) {
      return NextResponse.json(
        { error: "Call center station not found" },
        { status: 404 },
      );
    }

    if (seat && !seat.telnyxCredentialId) {
      return NextResponse.json(
        { error: "Selected call center station is missing Telnyx credentials" },
        { status: 422 },
      );
    }

    if (seat && browserSessionId && !allowsSharedCallCenterStation(context, seat)) {
      const leasedByAnotherBrowser = await prisma.callCenterPresence.findFirst({
        select: {
          browserSessionId: true,
          lastSeenAt: true,
          status: true,
        },
        where: {
          browserSessionId: {
            not: browserSessionId,
          },
          lastSeenAt: {
            gte: getPresenceExpirationCutoff(),
          },
          seatId: seat.id,
          status: {
            not: "OFFLINE",
          },
        },
      });

      if (leasedByAnotherBrowser) {
        return NextResponse.json(
          { error: "Selected call center station is already active in another browser" },
          { status: 409 },
        );
      }
    }

    const credentialId = seat?.telnyxCredentialId || runtimeSettings.credentialId;
    const callerNumber =
      getAllowedCallCenterOutboundPhoneNumbers(context)[0]?.phoneNumber ||
      runtimeSettings.outboundCallerNumber;
    const sipUsername = env("TELNYX_SIP_USERNAME");
    const sipPassword = env("TELNYX_SIP_PASSWORD");

    if (!seat && !runtimeSettings.credentialId) {
      return NextResponse.json(
        { error: "Select an assigned call center station" },
        { status: 422 },
      );
    }

    if (!seat && sipUsername && sipPassword) {
      return NextResponse.json({
        callerNumber,
        login: sipUsername,
        password: sipPassword,
      });
    }

    if (!credentialId) {
      return NextResponse.json(
        { error: "Telnyx WebRTC credentials are not configured" },
        { status: 422 },
      );
    }

    const token = await createTelnyxLoginToken(credentialId);

    return NextResponse.json({
      callerNumber,
      stationLabel: seat?.label ?? null,
      token,
    });
  },
  {
    errorMessage: "Failed to create Telnyx token",
    logLabel: "[portal-call-center] Failed to create Telnyx token",
  },
);
