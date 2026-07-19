import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonBody } from "@/lib/api/handler";
import {
  MAX_BROWSER_LIFECYCLE_BATCH_SIZE,
  recordBrowserLifecycle,
  type BrowserLifecycleEvent,
} from "@/lib/call-center/application/record-browser-lifecycle";
import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { prismaBrowserLifecycleStore } from "@/lib/call-center/infrastructure/prisma-browser-lifecycle-store";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

const nullableId = z.string().trim().min(1).max(200).nullable();
const eventSchema = z
  .object({
    agentSessionId: z.string().trim().min(1).max(200),
    answerOperationId: z.string().trim().min(1).max(200).optional(),
    answerOutcome: z.enum(["FAILED", "SUCCEEDED"]).optional(),
    browserClientInstanceId: z.string().trim().min(1).max(200),
    callId: nullableId,
    callLegId: nullableId,
    category: z.enum([
      "ANSWER_FAILED",
      "ANSWER_SUCCEEDED",
      "REATTACH_CORRELATION_FAILED",
      "REATTACH_FAILED",
      "REATTACH_SUCCEEDED",
      "SDK_READY",
      "SIGNALING_INTERRUPTED",
    ]),
    connectionGeneration: z.number().int().nonnegative().max(1_000_000),
    connectionId: z.string().trim().min(1).max(200),
    connectionState: z.enum(["CONNECTING", "FAILED", "OFFLINE", "READY"]),
    datacenter: z.string().trim().min(1).max(100).nullable(),
    deploymentRevision: z.string().trim().min(1).max(200).nullable(),
    errorCode: z.string().trim().min(1).max(100).optional(),
    errorFatal: z.boolean().optional(),
    errorName: z.string().trim().min(1).max(100).optional(),
    eventId: z.string().trim().min(1).max(200),
    occurredAt: z.iso.datetime(),
    providerCallControlId: nullableId,
    providerCallLegId: nullableId,
    providerCallSessionId: nullableId,
    recoveredCallId: nullableId,
    region: z.string().trim().min(1).max(100).nullable(),
    sdkCallId: nullableId,
    sdkCallState: z.string().trim().min(1).max(100).nullable(),
    sdkVersion: z.string().trim().min(1).max(50),
  })
  .strict();
const bodySchema = z
  .object({
    events: z.array(eventSchema).min(1).max(MAX_BROWSER_LIFECYCLE_BATCH_SIZE),
  })
  .strict();

export function createBrowserLifecycleHandler({
  getActor,
  record = recordBrowserLifecycle,
}: {
  getActor: () => Promise<QueueAccessActor>;
  record?: (
    store: typeof prismaBrowserLifecycleStore,
    actor: QueueAccessActor,
    events: readonly BrowserLifecycleEvent[],
  ) => ReturnType<typeof recordBrowserLifecycle>;
}) {
  return withCallCenterApiHandler(
    async (request: Request) => {
      const body = await parseJsonBody(request, bodySchema);
      const result = await record(
        prismaBrowserLifecycleStore,
        await getActor(),
        body.events,
      );
      return NextResponse.json(result, { status: 202 });
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] browser lifecycle telemetry failed",
      retryable: true,
    },
  );
}
