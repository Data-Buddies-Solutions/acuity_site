import { NextRequest, NextResponse } from "next/server";

import {
  fetchTelnyxRecordingMetadata,
  getCurrentPracticeCallCenterContext,
} from "@/lib/call-center";
import { buildPortalLocationScopeWhere } from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ recordingId: string }> },
) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { recordingId } = await params;
  const voicemail = await prisma.callCenterVoicemail.findFirst({
    select: {
      durationSec: true,
      id: true,
      recordingUrl: true,
    },
    where: {
      practiceId: context.practice.id,
      recordingId,
      ...buildPortalLocationScopeWhere(context),
    },
  });

  if (!voicemail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const recordingMetadata = await fetchTelnyxRecordingMetadata(recordingId);
  const recordingUrls = [recordingMetadata?.recordingUrl, voicemail.recordingUrl].filter(
    (url, index, urls): url is string => Boolean(url && urls.indexOf(url) === index),
  );

  if (recordingUrls.length === 0) {
    return NextResponse.json({ error: "No recording URL available" }, { status: 404 });
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
    return NextResponse.json({ error: "Failed to fetch recording" }, { status: 502 });
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
}
