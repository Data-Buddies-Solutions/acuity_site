import { NextRequest, NextResponse } from "next/server";

import { buildDialCompleteTexml } from "@/lib/call-center";
import { verifyTelnyxWebhookSignature } from "@/lib/telnyx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function paramsFromSearchParams(searchParams: URLSearchParams) {
  return Object.fromEntries(searchParams.entries());
}

function hasTelnyxSignature(request: NextRequest) {
  return Boolean(
    request.headers.get("telnyx-signature-ed25519") &&
    request.headers.get("telnyx-timestamp"),
  );
}

function xmlResponse(xml: string) {
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const body = await request.text();

  if (
    hasTelnyxSignature(request) &&
    !verifyTelnyxWebhookSignature({
      rawBody: body,
      signature: request.headers.get("telnyx-signature-ed25519"),
      timestamp: request.headers.get("telnyx-timestamp"),
    })
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const xml = await buildDialCompleteTexml(
    paramsFromSearchParams(new URLSearchParams(body)),
    url.origin,
  );

  return xmlResponse(xml);
}
