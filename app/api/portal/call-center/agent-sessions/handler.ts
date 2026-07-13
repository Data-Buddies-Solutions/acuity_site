import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CallCenterAgentConnectionState,
  CallCenterAgentPresence,
} from "@/generated/prisma/client";
import {
  parseJsonBody,
  requirePortalCallCenterContext,
  withApiHandler,
} from "@/lib/api/handler";
import {
  acquireAgentSession,
  AGENT_SESSION_LEASE_MS,
  type AgentSessionActor,
  releaseAgentSession,
  updateAgentSessionReadiness,
} from "@/lib/call-center/application/agent-sessions";
import { prismaAgentSessionStore } from "@/lib/call-center/infrastructure/prisma-agent-session-store";
import { serializeAgentSessionView } from "@/lib/call-center/domain/agent-session-wire";

const identitySchema = z.object({
  clientInstanceId: z.string().trim().min(1).max(200),
});
const readinessSchema = identitySchema.extend({
  audioReady: z.boolean(),
  connectionState: z.enum(CallCenterAgentConnectionState),
  expectedStateVersion: z.number().int().nonnegative(),
  microphoneReady: z.boolean(),
  presence: z.enum(CallCenterAgentPresence),
});
const releaseSchema = identitySchema.extend({
  expectedStateVersion: z.number().int().nonnegative(),
});
const paramsSchema = z.object({ sessionId: z.string().trim().min(1).max(200) });

type RouteContext = { params: Promise<{ sessionId: string }> };
type RequestContext = { actor: AgentSessionActor };
type AgentSessionHandlersDependencies = {
  acquire?: typeof acquireAgentSession;
  clock?: () => Date;
  getContext?: () => Promise<RequestContext>;
  release?: typeof releaseAgentSession;
  updateReadiness?: typeof updateAgentSessionReadiness;
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
  acquire = acquireAgentSession,
  clock = () => new Date(),
  getContext = getRequestContext,
  release = releaseAgentSession,
  updateReadiness = updateAgentSessionReadiness,
}: AgentSessionHandlersDependencies = {}) {
  const POST = withApiHandler(
    async (request: Request) => {
      const context = await getContext();
      const input = await parseJsonBody(request, identitySchema);
      const acquired = await acquire(
        prismaAgentSessionStore,
        context.actor,
        input,
        clock(),
      );

      return NextResponse.json({
        leaseDurationMs: AGENT_SESSION_LEASE_MS,
        session: serializeAgentSessionView(acquired.session),
      });
    },
    {
      errorMessage: "Failed to start call center session",
      logLabel: "[portal-call-center] Failed to start canonical agent session",
    },
  );

  const PATCH = withApiHandler(
    async (request: Request, routeContext: RouteContext) => {
      const context = await getContext();
      const sessionId = await readSessionId(routeContext);
      const input = await parseJsonBody(request, readinessSchema);
      const result = await updateReadiness(
        prismaAgentSessionStore,
        context.actor,
        { ...input, sessionId },
        clock(),
      );

      return NextResponse.json({ session: serializeAgentSessionView(result.session) });
    },
    {
      errorMessage: "Failed to update call center readiness",
      logLabel: "[portal-call-center] Failed to update canonical readiness",
    },
  );

  const DELETE = withApiHandler(
    async (request: Request, routeContext: RouteContext) => {
      const context = await getContext();
      const sessionId = await readSessionId(routeContext);
      const input = await parseJsonBody(request, releaseSchema);
      const result = await release(
        prismaAgentSessionStore,
        context.actor,
        { ...input, sessionId },
        clock(),
      );

      return NextResponse.json({ session: serializeAgentSessionView(result.session) });
    },
    {
      errorMessage: "Failed to release call center session",
      logLabel: "[portal-call-center] Failed to release canonical agent session",
    },
  );

  return { DELETE, PATCH, POST };
}
