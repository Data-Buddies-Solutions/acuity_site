import { NextRequest, NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

async function requireAudioAccess() {
  const session = await getAuthSession();

  return isAdminEmail(session?.user.email);
}

async function getAudio(callId: string) {
  const call = await prisma.agentCall.findFirst({
    select: {
      audioData: true,
    },
    where: {
      OR: [{ id: callId }, { callId }],
    },
  });

  return call?.audioData ?? null;
}

function getAudioFormat(bytes: Buffer) {
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67) {
    return { extension: "ogg", mime: "audio/ogg" };
  }

  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return { extension: "mp3", mime: "audio/mpeg" };
  }

  return { extension: "wav", mime: "audio/wav" };
}

export async function HEAD(
  _request: NextRequest,
  { params }: { params: Promise<{ callId: string }> },
) {
  if (!(await requireAudioAccess())) {
    return new NextResponse(null, { status: 401 });
  }

  const { callId } = await params;
  const audio = await getAudio(callId);

  if (!audio) {
    return new NextResponse(null, { status: 404 });
  }

  const bytes = Buffer.from(audio);
  return new NextResponse(null, {
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(bytes.length),
    },
    status: 200,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> },
) {
  if (!(await requireAudioAccess())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { callId } = await params;
  const audio = await getAudio(callId);

  if (!audio) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bytes = Buffer.from(audio);
  const { extension, mime } = getAudioFormat(bytes);
  const size = bytes.length;
  const range = request.headers.get("range");

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return new NextResponse(null, {
        headers: { "Content-Range": `bytes */${size}` },
        status: 416,
      });
    }

    const start = match[1] ? Number(match[1]) : 0;
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;
    const end = Math.min(requestedEnd, size - 1);

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      start > end ||
      start >= size
    ) {
      return new NextResponse(null, {
        headers: { "Content-Range": `bytes */${size}` },
        status: 416,
      });
    }

    const chunk = bytes.subarray(start, end + 1);
    return new NextResponse(chunk, {
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=86400",
        "Content-Disposition": `inline; filename="${callId}.${extension}"`,
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Type": mime,
      },
      status: 206,
    });
  }

  return new NextResponse(bytes, {
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": `inline; filename="${callId}.${extension}"`,
      "Content-Length": String(size),
      "Content-Type": mime,
    },
  });
}
