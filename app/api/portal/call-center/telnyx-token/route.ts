import { NextRequest, NextResponse } from "next/server";

import { requirePortalCallCenterContext } from "@/lib/api/handler";
import {
  allowsSharedCallCenterStation,
  buildCallCenterSeatAccessWhere,
  getAllowedCallCenterOutboundPhoneNumbers,
  getPresenceExpirationCutoff,
  resolveTelnyxRuntimeSettings,
} from "@/lib/call-center";
import { createTelnyxLoginToken } from "@/lib/telnyx";
import { prisma } from "@/lib/prisma";
import {
  CallCenterOperatorError,
  withCallCenterApiHandler,
} from "@/lib/call-center/operator-error-response";

export const dynamic = "force-dynamic";

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export const GET = withCallCenterApiHandler(
  async (request: NextRequest) => {
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
      throw new CallCenterOperatorError("CALL_CENTER_STATION_NOT_FOUND", 404);
    }

    if (seat && !seat.telnyxCredentialId) {
      throw new CallCenterOperatorError("CALLING_NOT_CONFIGURED", 422);
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
        throw new CallCenterOperatorError("CALL_CENTER_STATION_IN_USE", 409);
      }
    }

    const credentialId = seat?.telnyxCredentialId || runtimeSettings.credentialId;
    const callerNumber =
      getAllowedCallCenterOutboundPhoneNumbers(context)[0]?.phoneNumber ||
      runtimeSettings.outboundCallerNumber;
    const sipUsername = env("TELNYX_SIP_USERNAME");
    const sipPassword = env("TELNYX_SIP_PASSWORD");

    if (!seat && !runtimeSettings.credentialId) {
      throw new CallCenterOperatorError("CALLING_NOT_CONFIGURED", 422);
    }

    if (!seat && sipUsername && sipPassword) {
      return NextResponse.json({
        callerNumber,
        login: sipUsername,
        password: sipPassword,
      });
    }

    if (!credentialId) {
      throw new CallCenterOperatorError("CALLING_NOT_CONFIGURED", 422);
    }

    const token = await createTelnyxLoginToken(credentialId);

    return NextResponse.json({
      callerNumber,
      stationLabel: seat?.label ?? null,
      token,
    });
  },
  {
    errorCode: "PROVIDER_UNAVAILABLE",
    logLabel: "[portal-call-center] Failed to create Telnyx token",
    retryable: true,
  },
);
