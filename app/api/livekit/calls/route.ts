import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody, withApiHandler } from "@/lib/api/handler";
import { ingestLiveKitCallPayload } from "@/lib/call-ingestion";
import type { LiveKitWebhookPayload } from "@/lib/call-types";

export const dynamic = "force-dynamic";

function getWebhookSecret() {
  return process.env.LIVEKIT_FORWARD_SYNC_SECRET || process.env.WEBHOOK_SECRET;
}

export const POST = withApiHandler(
  async (request: NextRequest) => {
    const secret = getWebhookSecret();

    if (!secret) {
      console.error(
        "[livekit-call-ingestion] Rejecting call ingestion: configure LIVEKIT_FORWARD_SYNC_SECRET or WEBHOOK_SECRET to enable this endpoint.",
      );

      return NextResponse.json(
        { error: "LiveKit ingestion is not configured" },
        { status: 503 },
      );
    }

    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await parseJsonBody(request);

    if (!body || typeof body !== "object" || !("callId" in body)) {
      return NextResponse.json({ error: "Missing callId" }, { status: 400 });
    }

    const result = await ingestLiveKitCallPayload(body as LiveKitWebhookPayload);
    return NextResponse.json({ ok: true, ...result });
  },
  {
    errorMessage: "Failed to store call",
    logLabel: "[livekit-call-ingestion] Failed to store call",
  },
);
