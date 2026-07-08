import { NextRequest, NextResponse } from "next/server";

import { ingestLiveKitTaskPayload, TaskIngestionError } from "@/lib/task-ingestion";

export const dynamic = "force-dynamic";

function getWebhookSecret() {
  return process.env.LIVEKIT_FORWARD_SYNC_SECRET || process.env.WEBHOOK_SECRET;
}

function isAuthorized(request: NextRequest) {
  const secret = getWebhookSecret();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await ingestLiveKitTaskPayload(body);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TaskIngestionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[livekit-task-ingestion] Failed to store task", error);
    return NextResponse.json({ error: "Failed to store task" }, { status: 500 });
  }
}
