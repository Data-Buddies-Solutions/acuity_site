import { SmsConversationStatus } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody, withApiHandler } from "@/lib/api/handler";
import {
  deleteSmsConversation,
  getSmsConversation,
  updateSmsConversationStatus,
} from "@/lib/sms/service";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { conversationId } = await context.params;
  const conversation = await getSmsConversation(conversationId);

  if (!conversation) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if ("notFound" in conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json(conversation);
}

export const PATCH = withApiHandler(
  async (request: NextRequest, context: RouteContext) => {
    const { conversationId } = await context.params;
    const body = await parseJsonBody(request);

    const status =
      body &&
      typeof body === "object" &&
      "status" in body &&
      ((body as { status?: unknown }).status === SmsConversationStatus.OPEN ||
        (body as { status?: unknown }).status === SmsConversationStatus.CLOSED)
        ? (body as { status: SmsConversationStatus }).status
        : null;

    if (!status) {
      return NextResponse.json(
        { error: "status must be OPEN or CLOSED" },
        { status: 422 },
      );
    }

    const result = await updateSmsConversationStatus(conversationId, status);

    if (!result) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (result.notFound) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  },
  {
    errorMessage: "Failed to update conversation",
    logLabel: "[portal-sms] Failed to update conversation",
  },
);

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { conversationId } = await context.params;
  const result = await deleteSmsConversation(conversationId);

  if (!result) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if ("notFound" in result && result.notFound) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  if ("notClosed" in result && result.notClosed) {
    return NextResponse.json(
      { error: "Only closed conversations can be deleted" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
