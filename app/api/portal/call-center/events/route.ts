import { NextResponse } from "next/server";

import { CallCenterNoteDisposition } from "@/generated/prisma/client";
import {
  buildCallCenterActivityScopeWhere,
  buildCallCenterNoteScopeWhere,
  buildCallCenterPatientSessionScopeWhere,
  buildCallCenterQueueScopeWhere,
  getCurrentPracticeCallCenterContext,
} from "@/lib/call-center";
import { canAccessPortalLocation } from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const STREAM_POLL_MS = 2_000;
const NULL_LOCATION = "__NULL__";

function streamHeaders() {
  return {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  };
}

function encodeEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function getCallCenterStateVersion({
  activityScopeWhere,
  noteScopeWhere,
  practiceId,
  queueScopeWhere,
  sessionScopeWhere,
}: {
  activityScopeWhere: ReturnType<typeof buildCallCenterActivityScopeWhere>;
  noteScopeWhere: ReturnType<typeof buildCallCenterNoteScopeWhere>;
  practiceId: string;
  queueScopeWhere: ReturnType<typeof buildCallCenterQueueScopeWhere>;
  sessionScopeWhere: ReturnType<typeof buildCallCenterPatientSessionScopeWhere>;
}) {
  const [queue, missed, voicemail, note, completedSession] = await Promise.all([
    prisma.callCenterQueueItem.aggregate({
      _count: {
        _all: true,
      },
      _max: {
        updatedAt: true,
      },
      where: {
        practiceId,
        status: {
          in: ["RINGING", "WAITING", "ASSIGNED", "ACTIVE", "VOICEMAIL"],
        },
        ...queueScopeWhere,
      },
    }),
    prisma.callCenterMissedCall.aggregate({
      _count: {
        _all: true,
      },
      _max: {
        updatedAt: true,
      },
      where: {
        calledBack: false,
        practiceId,
        resolvedAt: null,
        ...activityScopeWhere,
      },
    }),
    prisma.callCenterVoicemail.aggregate({
      _count: {
        _all: true,
      },
      _max: {
        updatedAt: true,
      },
      where: {
        practiceId,
        resolvedAt: null,
        ...activityScopeWhere,
      },
    }),
    prisma.callCenterNote.aggregate({
      _count: {
        _all: true,
      },
      _max: {
        updatedAt: true,
      },
      where: {
        disposition: {
          in: [
            CallCenterNoteDisposition.CALLBACK_NEEDED,
            CallCenterNoteDisposition.FOLLOW_UP_REQUIRED,
          ],
        },
        practiceId,
        resolvedThread: false,
        ...noteScopeWhere,
      },
    }),
    prisma.callCenterSession.aggregate({
      _count: {
        _all: true,
      },
      _max: {
        updatedAt: true,
      },
      where: {
        practiceId,
        status: "COMPLETED",
        ...sessionScopeWhere,
      },
    }),
  ]);

  return JSON.stringify({
    completedSessionCount: completedSession._count._all,
    completedSessionUpdatedAt: completedSession._max.updatedAt?.toISOString() ?? null,
    missedCount: missed._count._all,
    missedUpdatedAt: missed._max.updatedAt?.toISOString() ?? null,
    noteCount: note._count._all,
    noteUpdatedAt: note._max.updatedAt?.toISOString() ?? null,
    queueCount: queue._count._all,
    queueUpdatedAt: queue._max.updatedAt?.toISOString() ?? null,
    voicemailCount: voicemail._count._all,
    voicemailUpdatedAt: voicemail._max.updatedAt?.toISOString() ?? null,
  });
}

export async function GET(request: Request) {
  const context = await getCurrentPracticeCallCenterContext();

  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = context.practice.callCenterSettings;

  if (!settings?.enabled) {
    return NextResponse.json(
      { error: "Call center is not enabled for this practice" },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const locationParam = url.searchParams.get("locationId");
  const locationId =
    locationParam === NULL_LOCATION ? null : locationParam?.trim() || undefined;
  if (locationId !== undefined && !canAccessPortalLocation(context, locationId)) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 });
  }

  const explicitLocationScope = locationId === undefined ? null : { locationId };
  const queueScopeWhere =
    explicitLocationScope ?? buildCallCenterQueueScopeWhere(context);
  const activityScopeWhere =
    explicitLocationScope ?? buildCallCenterActivityScopeWhere(context);
  const noteScopeWhere = explicitLocationScope ?? buildCallCenterNoteScopeWhere(context);
  const sessionScopeWhere =
    explicitLocationScope ?? buildCallCenterPatientSessionScopeWhere(context);
  let lastVersion = await getCallCenterStateVersion({
    activityScopeWhere,
    noteScopeWhere,
    practiceId: context.practice.id,
    queueScopeWhere,
    sessionScopeWhere,
  });

  let closeStream: (() => void) | null = null;

  const stream = new ReadableStream({
    cancel() {
      closeStream?.();
      closeStream = null;
    },
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let interval: ReturnType<typeof setInterval> | null = null;
      const send = (event: string, data: unknown) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(encodeEvent(event, data)));
        } catch {
          closed = true;
          if (interval) {
            clearInterval(interval);
            interval = null;
          }
        }
      };
      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        try {
          controller.close();
        } catch {
          // The client may already have closed the stream.
        }
      };

      interval = setInterval(async () => {
        if (closed) {
          return;
        }

        try {
          const nextVersion = await getCallCenterStateVersion({
            activityScopeWhere,
            noteScopeWhere,
            practiceId: context.practice.id,
            queueScopeWhere,
            sessionScopeWhere,
          });

          if (nextVersion !== lastVersion) {
            lastVersion = nextVersion;
            send("refresh", JSON.parse(nextVersion));
          } else {
            send("ping", { at: new Date().toISOString() });
          }
        } catch (error) {
          send("error", {
            message: error instanceof Error ? error.message : "call_center_stream_failed",
          });
        }
      }, STREAM_POLL_MS);

      closeStream = close;
      request.signal.addEventListener("abort", close);
      send("ready", JSON.parse(lastVersion));
    },
  });

  return new Response(stream, {
    headers: streamHeaders(),
  });
}
