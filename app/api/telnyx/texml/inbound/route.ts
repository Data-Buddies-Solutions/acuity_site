import { NextRequest, NextResponse } from "next/server";

import { buildInboundCallCenterTexml } from "@/lib/call-center";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function paramsFromSearchParams(searchParams: URLSearchParams) {
  return Object.fromEntries(searchParams.entries());
}

function xmlResponse(xml: string) {
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const xml = await buildInboundCallCenterTexml(
    paramsFromSearchParams(url.searchParams),
    url.origin,
  );

  return xmlResponse(xml);
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const body = await request.text();
  const xml = await buildInboundCallCenterTexml(
    paramsFromSearchParams(new URLSearchParams(body)),
    url.origin,
  );

  return xmlResponse(xml);
}
