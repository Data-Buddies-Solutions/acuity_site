import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import {
  QueueAccessError,
  queueAccessKey,
  resolveQueueAccess,
} from "@/lib/call-center/auth/queue-access";
import {
  readCanonicalEventBatch,
  readEventBounds,
} from "@/lib/call-center/application/realtime-queries";
import {
  requestedRevision,
  resumePlan,
  revisionString,
} from "@/lib/call-center/realtime";
import { CallCenterOperatorError } from "@/lib/call-center/operator-error-response";

const HEARTBEAT_MS = 10_000;
const POLL_MS = 1_000;
const STREAM_LIFETIME_MS = 25_000;

type Dependencies = {
  clock?: () => number;
  getActor: () => Promise<QueueAccessActor>;
  readBatch?: typeof readCanonicalEventBatch;
  readBounds?: typeof readEventBounds;
  reportFailure?: (errorCode: string) => void;
  resolveAccess?: typeof resolveQueueAccess;
  streamLifetimeMs?: number;
};

function headers() {
  return {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  };
}

export function encodeCanonicalEvent(id: string, event: string, data: unknown) {
  const safeEvent = /^[A-Za-z0-9._:-]{1,100}$/.test(event) ? event : "projection";
  return `id: ${id}\nevent: ${safeEvent}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function encodeReset(reason: string, revision: bigint) {
  const id = revisionString(revision);
  return `id: ${id}\nevent: reset\ndata: ${JSON.stringify({ reason, revision: id })}\n\n`;
}

export function encodeCursor(revision: bigint) {
  const id = revisionString(revision);
  return `id: ${id}\nevent: cursor\ndata: ${JSON.stringify({ revision: id })}\n\n`;
}

function reportStreamFailure(errorCode: string) {
  console.error("[canonical-call-center-stream] stream closed", { errorCode });
}

export function createCanonicalEventsHandler({
  clock = Date.now,
  getActor,
  readBatch = readCanonicalEventBatch,
  readBounds = readEventBounds,
  reportFailure = reportStreamFailure,
  resolveAccess = resolveQueueAccess,
  streamLifetimeMs = STREAM_LIFETIME_MS,
}: Dependencies) {
  return async function GET(request: Request) {
    const url = new URL(request.url);
    const queueId = url.searchParams.get("queueId")?.trim();
    const clientInstanceId = url.searchParams.get("clientInstanceId")?.trim();
    if (!queueId) throw new CallCenterOperatorError("INVALID_REQUEST", 400);
    if (!clientInstanceId || clientInstanceId.length > 200) {
      throw new CallCenterOperatorError("INVALID_REQUEST", 400);
    }

    const actor = await getActor();
    const initialAccessKey = queueAccessKey(actor);
    await resolveAccess(actor, queueId);

    const bounds = await readBounds();
    const requested = requestedRevision(
      request.headers.get("last-event-id"),
      url.searchParams.get("after"),
    );
    const plan = resumePlan({
      latestRevision: bounds.latestRevision,
      requested: requested.revision,
      requestedProvided: requested.provided,
      retentionFloor: bounds.retentionFloor,
    });
    const encoder = new TextEncoder();

    if (plan.kind === "reset") {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(encodeReset(plan.reason, plan.cursor)));
            controller.close();
          },
        }),
        { headers: headers() },
      );
    }

    let closeStream: (() => void) | null = null;
    const stream = new ReadableStream({
      cancel() {
        closeStream?.();
        closeStream = null;
      },
      start(controller) {
        let closed = false;
        let scanCursor = plan.cursor;
        let lastHeartbeat = clock();
        const startedAt = clock();
        let timer: ReturnType<typeof setTimeout> | null = null;
        const close = () => {
          if (closed) return;
          closed = true;
          if (timer) clearTimeout(timer);
          try {
            controller.close();
          } catch {
            // The browser may already have closed the stream.
          }
        };
        const send = (value: string) => {
          if (closed) return false;
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            reportFailure("CALL_CENTER_STREAM_BACKPRESSURE");
            close();
            return false;
          }
          controller.enqueue(encoder.encode(value));
          return true;
        };
        const poll = async () => {
          if (closed) return;
          if (request.signal.aborted) {
            close();
            return;
          }
          if (clock() - startedAt >= streamLifetimeMs) {
            send('event: rotate\ndata: {"reason":"STREAM_LIFETIME"}\n\n');
            close();
            return;
          }

          try {
            const batch = await readBatch(
              { practiceId: actor.practiceId, userId: actor.userId },
              queueId,
              clientInstanceId,
              scanCursor,
            );
            if (batch.accessKey !== initialAccessKey) {
              reportFailure("CALL_CENTER_STREAM_ACCESS_CHANGED");
              send(encodeReset("ACCESS_CHANGED", scanCursor));
              close();
              return;
            }
            const reset = batch.items.find(({ reset }) => reset);
            if (reset) {
              send(encodeReset("UNAPPLICABLE_DELTA", reset.revision));
              close();
              return;
            }

            if (batch.scannedThrough !== null) {
              let frames = "";
              for (const item of batch.items) {
                if (item.projection) {
                  frames += encodeCanonicalEvent(
                    item.projection.revision,
                    "projection",
                    item.projection,
                  );
                }
              }
              frames += encodeCursor(batch.scannedThrough);
              if (!send(frames)) return;
              scanCursor = batch.scannedThrough;
            }
            if (clock() - lastHeartbeat >= HEARTBEAT_MS) {
              send(`: heartbeat ${new Date(clock()).toISOString()}\n\n`);
              lastHeartbeat = clock();
            }
          } catch (error) {
            if (error instanceof QueueAccessError) {
              reportFailure("CALL_CENTER_STREAM_ACCESS_CHANGED");
              send(encodeReset("ACCESS_CHANGED", scanCursor));
              close();
              return;
            }
            reportFailure("CALL_CENTER_STREAM_POLL_FAILED");
            close();
            return;
          }

          if (!closed) timer = setTimeout(poll, POLL_MS);
        };

        closeStream = close;
        request.signal.addEventListener("abort", close, { once: true });
        void poll();
      },
    });

    return new Response(stream, { headers: headers() });
  };
}
