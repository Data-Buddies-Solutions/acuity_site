import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonBody, withApiHandler } from "@/lib/api/handler";
import { getSmsInbox, startOutboundSmsConversation } from "@/lib/sms/service";

export const dynamic = "force-dynamic";

const startConversationSchema = z.object({
  body: z.string().optional().default(""),
  inboxId: z.string().trim().min(1, "Texting inbox is required"),
  patientPhoneNumber: z.string().trim().optional().default(""),
});

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
    const {
      body: text,
      inboxId: practiceNumberId,
      patientPhoneNumber,
    } = await parseJsonBody(request, startConversationSchema);

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
