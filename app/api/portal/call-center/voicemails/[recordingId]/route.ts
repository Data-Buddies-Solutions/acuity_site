import { NextRequest, NextResponse } from "next/server";

import { operatorFollowUp } from "@/lib/call-center/operator-follow-up";
import {
  CallCenterOperatorError,
  withCallCenterApiHandler,
} from "@/lib/call-center/operator-error-response";
import { getCurrentPortalPracticeContext } from "@/lib/portal-access";

export const dynamic = "force-dynamic";

export const GET = withCallCenterApiHandler(
  async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ recordingId: string }> },
  ) {
    const context = await getCurrentPortalPracticeContext();
    if (!context) {
      throw new CallCenterOperatorError("AUTH_REQUIRED", 401);
    }
    const playback = await operatorFollowUp.playVoicemail(
      {
        allowedLocationIds: context.allowedLocationIds,
        hasAllLocationAccess: context.hasAllLocationAccess,
        practiceId: context.practice.id,
        userId: context.session.user.id,
      },
      {
        range: request.headers.get("range"),
        recordingId: (await params).recordingId,
      },
    );
    return new NextResponse(playback.body, playback);
  },
  {
    errorCode: "VOICEMAIL_UNAVAILABLE",
    logLabel: "voicemail playback failed",
    retryable: true,
  },
);
