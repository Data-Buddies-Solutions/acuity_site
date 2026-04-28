import { NextResponse } from "next/server";

import {
  getCurrentPracticeCallCenterContext,
  resolveTelnyxRuntimeSettings,
} from "@/lib/call-center";
import { createTelnyxLoginToken, TelnyxError } from "@/lib/telnyx";

export const dynamic = "force-dynamic";

export async function GET() {
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

  if (!runtimeSettings.credentialId) {
    return NextResponse.json(
      { error: "Telnyx credential ID is not configured" },
      { status: 422 },
    );
  }

  try {
    const token = await createTelnyxLoginToken(runtimeSettings.credentialId);

    return NextResponse.json({
      callerNumber: runtimeSettings.outboundCallerNumber,
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
