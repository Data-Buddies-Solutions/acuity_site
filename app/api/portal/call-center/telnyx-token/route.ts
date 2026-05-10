import { NextResponse } from "next/server";

import {
  getCurrentPracticeCallCenterContext,
  getPresenceExpirationCutoff,
  resolveTelnyxRuntimeSettings,
} from "@/lib/call-center";
import { createTelnyxLoginToken, TelnyxError } from "@/lib/telnyx";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export async function GET(request: Request) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = context.practice.callCenterSettings;

  if (!settings?.enabled) {
    return NextResponse.json(
      { error: "Call center is not enabled for this practice" },
      { status: 403 },
    );
  }

  const runtimeSettings = resolveTelnyxRuntimeSettings(settings);
  const url = new URL(request.url);
  const browserSessionId = url.searchParams.get("browserSessionId")?.trim() || "";
  const seatId = url.searchParams.get("seatId")?.trim() || "";
  const seat = seatId
    ? await prisma.callCenterAgentSeat.findFirst({
        select: {
          id: true,
          label: true,
          telnyxCredentialId: true,
        },
        where: {
          enabled: true,
          id: seatId,
          practiceId: context.practice.id,
        },
      })
    : null;

  if (seatId && !seat) {
    return NextResponse.json({ error: "Call center station not found" }, { status: 404 });
  }

  if (seat && !seat.telnyxCredentialId) {
    return NextResponse.json(
      { error: "Selected call center station is missing Telnyx credentials" },
      { status: 422 },
    );
  }

  if (seat && browserSessionId) {
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
  const sipUsername = env("TELNYX_SIP_USERNAME");
  const sipPassword = env("TELNYX_SIP_PASSWORD");

  if (!seat && sipUsername && sipPassword) {
    return NextResponse.json({
      callerNumber: runtimeSettings.outboundCallerNumber,
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

  try {
    const token = await createTelnyxLoginToken(credentialId);

    return NextResponse.json({
      callerNumber: runtimeSettings.outboundCallerNumber,
      stationLabel: seat?.label ?? null,
      token,
    });
  } catch (error) {
    if (error instanceof TelnyxError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[portal-call-center] Failed to create Telnyx token", error);
    return NextResponse.json({ error: "Failed to create Telnyx token" }, { status: 500 });
  }
}
