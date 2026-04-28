import { NextRequest, NextResponse } from "next/server";

import { getCurrentPracticeCallCenterContext } from "@/lib/call-center";
import { prisma } from "@/lib/prisma";
import { getTelnyxRecording } from "@/lib/telnyx";

export const dynamic = "force-dynamic";

async function fetchRecordingDownloadUrl(recordingId: string) {
  const response = await getTelnyxRecording(recordingId);

  if (!response.ok) {
    return null;
  }

  const json = await response.json();

  return (
    json?.data?.download_urls?.mp3 ||
    json?.data?.download_urls?.wav ||
    json?.data?.recording_urls?.mp3 ||
    json?.data?.recording_urls?.wav ||
    null
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ recordingId: string }> },
) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { recordingId } = await params;
  const voicemail = await prisma.callCenterVoicemail.findFirst({
    select: {
      id: true,
      recordingUrl: true,
    },
    where: {
      practiceId: context.practice.id,
      recordingId,
    },
  });

  if (!voicemail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const recordingUrl =
    voicemail.recordingUrl || (await fetchRecordingDownloadUrl(recordingId));

  if (!recordingUrl) {
    return NextResponse.json({ error: "No recording URL available" }, { status: 404 });
  }

  const audioResponse = await fetch(recordingUrl, {
    headers: process.env.TELNYX_API_KEY
      ? { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` }
      : undefined,
  });

  if (!audioResponse.ok || !audioResponse.body) {
    return NextResponse.json({ error: "Failed to fetch recording" }, { status: 502 });
  }

  await prisma.callCenterVoicemail.update({
    data: {
      listenedAt: new Date(),
    },
    where: {
      id: voicemail.id,
    },
  });

  return new NextResponse(audioResponse.body, {
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Type": audioResponse.headers.get("content-type") || "audio/mpeg",
    },
  });
}
