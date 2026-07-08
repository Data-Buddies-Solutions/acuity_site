import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody, withApiHandler } from "@/lib/api/handler";
import { sendSmsReply } from "@/lib/sms/service";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export const POST = withApiHandler(
  async (request: NextRequest, context: RouteContext) => {
    const { conversationId } = await context.params;
    const body = await parseJsonBody(request);

    const text =
      body && typeof body === "object" && "body" in body
        ? String((body as { body?: unknown }).body ?? "")
        : "";

    const result = await sendSmsReply(conversationId, text);

    if (!result) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if ("notFound" in result) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  },
  {
    errorMessage: "Failed to send SMS reply",
    logLabel: "[portal-sms] Failed to send SMS reply",
  },
);
