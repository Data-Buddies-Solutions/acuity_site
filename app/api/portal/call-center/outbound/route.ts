import { NextRequest, NextResponse } from "next/server";

import {
  getAllowedCallCenterOutboundPhoneNumbers,
  getCurrentPracticeCallCenterContext,
  normalizePhone,
  phoneLookupVariants,
  resolveTelnyxRuntimeSettings,
} from "@/lib/call-center";
import { dialTelnyxCall, TelnyxError } from "@/lib/telnyx";

export const dynamic = "force-dynamic";

function isPracticeNumber(phone: string, numbers: Array<{ phoneNumber: string }>) {
  const variants = new Set(phoneLookupVariants(phone));

  return numbers.some((number) =>
    phoneLookupVariants(number.phoneNumber).some((variant) => variants.has(variant)),
  );
}

export async function POST(request: NextRequest) {
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { callControlId, destination, fromPhone } = body as {
    callControlId?: string;
    destination?: string;
    fromPhone?: string;
  };
  const runtimeSettings = resolveTelnyxRuntimeSettings(settings);
  const from = normalizePhone(fromPhone || runtimeSettings.outboundCallerNumber);
  const to = normalizePhone(destination);

  if (!to) {
    return NextResponse.json({ error: "destination is required" }, { status: 400 });
  }

  const allowedOutboundPhoneNumbers = getAllowedCallCenterOutboundPhoneNumbers(context);

  if (!from || !isPracticeNumber(from, allowedOutboundPhoneNumbers)) {
    return NextResponse.json(
      { error: "fromPhone must be a practice-owned number" },
      { status: 422 },
    );
  }

  try {
    const result = await dialTelnyxCall({
      connectionId: runtimeSettings.connectionId,
      from,
      linkTo: callControlId ? `v3:${callControlId}` : undefined,
      to,
    });

    return NextResponse.json({
      callControlId: result?.data?.call_control_id ?? null,
      ok: true,
    });
  } catch (error) {
    if (error instanceof TelnyxError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[portal-call-center] Failed to place outbound call", error);
    return NextResponse.json({ error: "Failed to place outbound call" }, { status: 500 });
  }
}
