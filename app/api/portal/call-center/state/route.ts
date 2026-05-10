import { NextResponse } from "next/server";

import { getPortalCallCenterOperationalState } from "@/lib/call-center";

export const dynamic = "force-dynamic";

const NULL_LOCATION = "__NULL__";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locationParam = url.searchParams.get("locationId");
  const locationId =
    locationParam === NULL_LOCATION ? null : locationParam?.trim() || undefined;
  const state = await getPortalCallCenterOperationalState(
    locationParam == null ? undefined : { locationId },
  );

  if (!state) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(state);
}
