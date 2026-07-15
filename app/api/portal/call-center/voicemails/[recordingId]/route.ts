import { NextRequest, NextResponse } from "next/server";

import { canonicalCallAccessWhere } from "@/lib/call-center/application/portal-canonical-history";
import { fetchTelnyxRecordingMetadata } from "@/lib/call-center/infrastructure/telnyx-recording";
import {
  CallCenterOperatorError,
  withCallCenterApiHandler,
} from "@/lib/call-center/operator-error-response";
import { prisma } from "@/lib/prisma";
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

    const { recordingId } = await params;
    const voicemail = await prisma.callCenterVoicemail.findFirst({
      select: {
        durationSec: true,
        id: true,
        recordingUrl: true,
      },
      where: {
        callCenterCall: canonicalCallAccessWhere(context),
        recordingId,
      },
    });

    if (!voicemail) {
      throw new CallCenterOperatorError("VOICEMAIL_UNAVAILABLE", 404);
    }

    const recordingMetadata = await fetchTelnyxRecordingMetadata(recordingId);
    const recordingUrls = [
      recordingMetadata?.recordingUrl,
      voicemail.recordingUrl,
    ].filter((url, index, urls): url is string =>
      Boolean(url && urls.indexOf(url) === index),
    );

    if (recordingUrls.length === 0) {
      throw new CallCenterOperatorError("VOICEMAIL_UNAVAILABLE", 404);
    }

    const upstreamHeaders: Record<string, string> = {};
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      upstreamHeaders.Range = rangeHeader;
    }

    let audioResponse: Response | null = null;
    for (const recordingUrl of recordingUrls) {
      try {
        const response = await fetch(recordingUrl, { headers: upstreamHeaders });
        if (response.ok && response.body) {
          audioResponse = response;
          break;
        }
      } catch {
        // Try the next available Telnyx recording URL.
      }
    }

    if (!audioResponse?.body) {
      throw new CallCenterOperatorError("VOICEMAIL_UNAVAILABLE", 502, true);
    }

    const updateData: {
      durationSec?: number;
      listenedAt?: Date;
      recordingUrl?: string;
    } = {};

    if (!rangeHeader) {
      updateData.listenedAt = new Date();
    }
    if (
      recordingMetadata?.durationSec &&
      recordingMetadata.durationSec > voicemail.durationSec
    ) {
      updateData.durationSec = recordingMetadata.durationSec;
    }
    if (
      recordingMetadata?.recordingUrl &&
      recordingMetadata.recordingUrl !== voicemail.recordingUrl
    ) {
      updateData.recordingUrl = recordingMetadata.recordingUrl;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.callCenterVoicemail.update({
        data: updateData,
        where: { id: voicemail.id },
      });
    }

    const responseHeaders = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
      "Content-Type": audioResponse.headers.get("content-type") || "audio/mpeg",
    });

    const contentLength = audioResponse.headers.get("content-length");
    if (contentLength) responseHeaders.set("Content-Length", contentLength);

    const contentRange = audioResponse.headers.get("content-range");
    if (contentRange) responseHeaders.set("Content-Range", contentRange);

    return new NextResponse(audioResponse.body, {
      headers: responseHeaders,
      status: audioResponse.status, // 200 or 206
    });
  },
  {
    errorCode: "VOICEMAIL_UNAVAILABLE",
    logLabel: "voicemail playback failed",
    retryable: true,
  },
);
