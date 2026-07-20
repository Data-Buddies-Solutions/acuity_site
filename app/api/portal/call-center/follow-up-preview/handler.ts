import { NextResponse } from "next/server";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import {
  CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT,
  readCanonicalNeedsActionPreview,
} from "@/lib/call-center/application/portal-canonical-history";
import {
  resolveQueueAccess,
  type QueueAccessActor,
} from "@/lib/call-center/auth/queue-access";
import { resolveCallerThread } from "@/lib/call-center/infrastructure/prisma-resolve-caller-thread";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";
import { phoneLookupVariants } from "@/lib/phone";

type Dependencies = {
  getActor: () => Promise<QueueAccessActor>;
  readPreview?: typeof readCanonicalNeedsActionPreview;
};

type ResolveDependencies = {
  getActor: () => Promise<QueueAccessActor>;
  resolveQueue?: typeof resolveQueueAccess;
  resolveThread?: typeof resolveCallerThread;
};

export function createFollowUpPreviewHandler({
  getActor,
  readPreview = readCanonicalNeedsActionPreview,
}: Dependencies) {
  return withCallCenterApiHandler(
    async (request: Request) => {
      const parameters = new URL(request.url).searchParams;
      const queueId = parameters.get("queueId")?.trim();
      const locationId = parameters.get("locationId")?.trim();
      if (!queueId) {
        throw new ApiError("A queue is required", 400);
      }

      const items = await readPreview(await getActor(), {
        locationIds: locationId ? [locationId] : [],
        queueId,
      });

      return NextResponse.json(
        {
          items: items.slice(0, CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT),
          limit: CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] Failed to load follow-up preview",
      retryable: true,
    },
  );
}

export function createResolveFollowUpPreviewHandler({
  getActor,
  resolveQueue = resolveQueueAccess,
  resolveThread = resolveCallerThread,
}: ResolveDependencies) {
  return withCallCenterApiHandler(
    async (request: Request) => {
      const body = await parseJsonBody(request);
      if (!isRecord(body)) throw new ApiError("Invalid request body", 400);

      const queueId = typeof body.queueId === "string" ? body.queueId.trim() : "";
      const locationId =
        typeof body.locationId === "string" ? body.locationId.trim() : "";
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      const phoneVariants = phoneLookupVariants(phone);
      if (!queueId || !phoneVariants.length) {
        throw new ApiError("A queue and phone number are required", 400);
      }

      const actor = await getActor();
      await resolveQueue(actor, queueId);
      const result = await resolveThread({
        actor,
        disposition: "RESOLVED",
        locationIds: locationId ? [locationId] : [],
        now: new Date(),
        phoneVariants,
        queueId,
      });

      return NextResponse.json(
        { ok: true, resolvedCount: result.canonicalTasksResolved },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] Failed to resolve follow-up preview item",
      retryable: true,
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
