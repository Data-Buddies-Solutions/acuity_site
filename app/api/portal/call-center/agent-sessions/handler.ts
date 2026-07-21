import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonBody, requirePortalCallCenterContext } from "@/lib/api/handler";
import { callCenter, type AgentUpdate } from "@/lib/call-center/call-center";
import {
  AGENT_SESSION_CONNECTION_STATES,
  AGENT_SESSION_LEASE_MS,
  type AgentSessionActor,
  type AgentSessionEndpoint,
  type AgentSessionRecord,
} from "@/lib/call-center/application/agent-sessions";
import { AGENT_AVAILABILITY_INTENTS } from "@/lib/call-center/domain/agent-session-readiness";
import { serializeAgentSessionView } from "@/lib/call-center/domain/agent-session-wire";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

const identitySchema = z.object({
  clientInstanceId: z.string().trim().min(1).max(200),
  takeover: z.boolean().optional(),
});
const readinessSchema = identitySchema.extend({
  audioReady: z.boolean(),
  availabilityIntent: z.enum(AGENT_AVAILABILITY_INTENTS).optional(),
  connectionState: z.enum(AGENT_SESSION_CONNECTION_STATES),
  expectedStateVersion: z.number().int().nonnegative(),
  microphoneReady: z.boolean(),
});
const releaseSchema = identitySchema.extend({
  expectedStateVersion: z.number().int().nonnegative(),
});
const paramsSchema = z.object({ sessionId: z.string().trim().min(1).max(200) });

type RouteContext = { params: Promise<{ sessionId: string }> };
type RequestContext = { actor: AgentSessionActor };
type UpdateAgentOperation = (
  update: AgentUpdate,
) => Promise<{ endpoint?: AgentSessionEndpoint; session: AgentSessionRecord }>;
type AgentSessionHandlersDependencies = {
  clock?: () => Date;
  getContext?: () => Promise<RequestContext>;
  updateAgent?: UpdateAgentOperation;
};

async function getRequestContext(): Promise<RequestContext> {
  const context = await requirePortalCallCenterContext();
  return {
    actor: {
      allowedLocationIds: context.allowedLocationIds,
      hasAllLocationAccess: context.hasAllLocationAccess,
      practiceId: context.practice.id,
      userId: context.session.user.id,
    },
  };
}

async function readSessionId(routeContext: RouteContext) {
  return paramsSchema.parse(await routeContext.params).sessionId;
}

export function createAgentSessionHandlers({
  clock = () => new Date(),
  getContext = getRequestContext,
  updateAgent = callCenter.updateAgent,
}: AgentSessionHandlersDependencies = {}) {
  const POST = withCallCenterApiHandler(
    async (request: Request) => {
      const context = await getContext();
      const input = await parseJsonBody(request, identitySchema);
      const acquired = await updateAgent({
        actor: context.actor,
        input,
        kind: "ACQUIRE",
        now: clock(),
      });

      return NextResponse.json({
        leaseDurationMs: AGENT_SESSION_LEASE_MS,
        session: serializeAgentSessionView(acquired.session),
      });
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] Failed to start canonical agent session",
      retryable: true,
    },
  );

  const PATCH = withCallCenterApiHandler(
    async (request: Request, routeContext: RouteContext) => {
      const context = await getContext();
      const sessionId = await readSessionId(routeContext);
      const input = await parseJsonBody(request, readinessSchema);
      const result = await updateAgent({
        actor: context.actor,
        input: { ...input, sessionId },
        kind: "HEARTBEAT",
        now: clock(),
      });

      return NextResponse.json({ session: serializeAgentSessionView(result.session) });
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] Failed to update canonical readiness",
      retryable: true,
    },
  );

  const DELETE = withCallCenterApiHandler(
    async (request: Request, routeContext: RouteContext) => {
      const context = await getContext();
      const sessionId = await readSessionId(routeContext);
      const input = await parseJsonBody(request, releaseSchema);
      const result = await updateAgent({
        actor: context.actor,
        input: { ...input, sessionId },
        kind: "RELEASE",
        now: clock(),
      });

      return NextResponse.json({ session: serializeAgentSessionView(result.session) });
    },
    {
      errorCode: "TEMPORARY_SERVICE_FAILURE",
      logLabel: "[portal-call-center] Failed to release canonical agent session",
      retryable: true,
    },
  );

  return { DELETE, PATCH, POST };
}
