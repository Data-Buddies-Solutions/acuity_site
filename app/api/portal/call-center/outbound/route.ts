import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  parseJsonBody,
  requirePortalCallCenterContext,
  withApiHandler,
} from "@/lib/api/handler";
import {
  getAllowedCallCenterOutboundPhoneNumbers,
  resolveTelnyxRuntimeSettings,
} from "@/lib/call-center";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { dialTelnyxCall } from "@/lib/telnyx";

export const dynamic = "force-dynamic";

const outboundSchema = z.object({
  callControlId: z.string().optional(),
  destination: z.string().optional(),
  fromPhone: z.string().optional(),
});

function isPracticeNumber(phone: string, numbers: Array<{ phoneNumber: string }>) {
  const variants = new Set(phoneLookupVariants(phone));

  return numbers.some((number) =>
    phoneLookupVariants(number.phoneNumber).some((variant) => variants.has(variant)),
  );
}

export const POST = withApiHandler(
  async (request: NextRequest) => {
    const context = await requirePortalCallCenterContext();
    const settings = context.practice.callCenterSettings;

    const { callControlId, destination, fromPhone } = await parseJsonBody(
      request,
      outboundSchema,
    );
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
  },
  {
    errorMessage: "Failed to place outbound call",
    logLabel: "[portal-call-center] Failed to place outbound call",
  },
);
