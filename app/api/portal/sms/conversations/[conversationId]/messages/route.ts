import { NextRequest, NextResponse } from "next/server";

import { sendSmsReply } from "@/lib/sms/service";
import { TelnyxError } from "@/lib/telnyx";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { conversationId } = await context.params;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text =
    body && typeof body === "object" && "body" in body
      ? String((body as { body?: unknown }).body ?? "")
      : "";

  try {
    const result = await sendSmsReply(conversationId, text);

    if (!result) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if ("notFound" in result) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TelnyxError) {
      return NextResponse.json(
        { detail: error.detail ?? null, error: error.message },
        { status: error.status },
      );
    }

    console.error("[portal-sms] Failed to send SMS reply", error);
    return NextResponse.json({ error: "Failed to send SMS reply" }, { status: 500 });
  }
}
