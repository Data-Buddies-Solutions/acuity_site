import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody, withApiHandler } from "@/lib/api/handler";
import { getSmsInbox, startOutboundSmsConversation } from "@/lib/sms/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const inbox = await getSmsInbox(
    url.searchParams.get("inboxId"),
    url.searchParams.get("search"),
  );

  if (!inbox) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(inbox);
}

export const POST = withApiHandler(
  async (request: NextRequest) => {
    const body = await parseJsonBody(request);
    const payload =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const practiceNumberId =
      typeof payload.inboxId === "string" ? payload.inboxId.trim() : "";
    const patientPhoneNumber =
      typeof payload.patientPhoneNumber === "string"
        ? payload.patientPhoneNumber.trim()
        : "";
    const text = typeof payload.body === "string" ? payload.body : "";

    if (!practiceNumberId) {
      return NextResponse.json({ error: "Texting inbox is required" }, { status: 422 });
    }

    const result = await startOutboundSmsConversation({
      body: text,
      patientPhoneNumber,
      practiceNumberId,
    });

    if (!result) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if ("notFound" in result) {
      return NextResponse.json({ error: "Texting inbox not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  },
  {
    errorMessage: "Failed to send SMS",
    logLabel: "[portal-sms] Failed to start outbound SMS",
  },
);
