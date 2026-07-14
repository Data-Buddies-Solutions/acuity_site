import { NextRequest, NextResponse } from "next/server";

import { getPortalCallCenterOperationalState } from "@/lib/call-center";
import {
  CallCenterOperatorError,
  withCallCenterApiHandler,
} from "@/lib/call-center/operator-error-response";

export const dynamic = "force-dynamic";

const NULL_LOCATION = "__NULL__";

export const GET = withCallCenterApiHandler(
  async (request: NextRequest) => {
    const url = new URL(request.url);
    const locationParam = url.searchParams.get("locationId");
    const locationId =
      locationParam === NULL_LOCATION ? null : locationParam?.trim() || undefined;
    const state = await getPortalCallCenterOperationalState(
      locationParam == null ? undefined : { locationId },
    );

    if (!state) {
      throw new CallCenterOperatorError("AUTH_REQUIRED", 401);
    }

    return NextResponse.json(state);
  },
  {
    errorCode: "TEMPORARY_SERVICE_FAILURE",
    logLabel: "legacy call center state failed",
    retryable: true,
  },
);
