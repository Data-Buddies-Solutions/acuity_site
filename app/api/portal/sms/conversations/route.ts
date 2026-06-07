import { NextRequest, NextResponse } from "next/server";

import { getSmsInbox, startOutboundSmsConversation } from "@/lib/sms/service";
import { TelnyxError } from "@/lib/telnyx";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const inbox = await getSmsInbox(url.searchParams.get("inboxId"));

  if (!inbox) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(inbox);
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

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

  try {
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
  } catch (error) {
    if (error instanceof TelnyxError) {
      return NextResponse.json(
        { detail: error.detail ?? null, error: error.message },
        { status: error.status },
      );
    }

    console.error("[portal-sms] Failed to start outbound SMS", error);
    return NextResponse.json({ error: "Failed to send SMS" }, { status: 500 });
  }
}
