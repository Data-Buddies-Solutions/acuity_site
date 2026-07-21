import { NextResponse } from "next/server";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import {
  CANONICAL_NEEDS_ACTION_PREVIEW_LIMIT,
  readCanonicalNeedsActionPreview,
} from "@/lib/call-center/application/portal-canonical-history";
import { type QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";
import type { operatorFollowUp } from "@/lib/call-center/operator-follow-up-runtime";

type Dependencies = {
  getActor: () => Promise<QueueAccessActor>;
  readPreview?: typeof readCanonicalNeedsActionPreview;
};

type ResolveDependencies = {
  followUp: Pick<typeof operatorFollowUp, "resolveCallerThread">;
  getActor: () => Promise<QueueAccessActor>;
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
  followUp,
  getActor,
}: ResolveDependencies) {
  return withCallCenterApiHandler(
    async (request: Request) => {
      const body = await parseJsonBody(request);
      if (!isRecord(body)) throw new ApiError("Invalid request body", 400);

      const queueId = typeof body.queueId === "string" ? body.queueId.trim() : "";
      const locationId =
        typeof body.locationId === "string" ? body.locationId.trim() : "";
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      const idempotencyKey =
        typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
      const taskIds = Array.isArray(body.taskIds)
        ? body.taskIds
            .filter((taskId): taskId is string => typeof taskId === "string")
            .map((taskId) => taskId.trim())
            .filter(Boolean)
        : [];
      if (!queueId || !phone || !idempotencyKey || !taskIds.length) {
        throw new ApiError(
          "A queue, phone number, and follow-up tasks are required",
          400,
        );
      }

      const actor = await getActor();
      const result = await followUp.resolveCallerThread(actor, {
        expectedTaskIds: taskIds,
        idempotencyKey,
        ...(locationId ? { locationId } : {}),
        phone,
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
