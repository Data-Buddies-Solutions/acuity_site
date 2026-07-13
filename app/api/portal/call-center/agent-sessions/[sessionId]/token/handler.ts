import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody, withApiHandler } from "@/lib/api/handler";
import {
  authorizeAgentSessionCredential,
  type AgentSessionCredentialActor,
} from "@/lib/call-center/application/agent-session-credentials";
import { prismaAgentSessionCredentialStore } from "@/lib/call-center/infrastructure/prisma-agent-session-credential-store";
import { resolveCallCenterActivationConfig } from "@/lib/call-center/infrastructure/call-center-activation-config";
import { createTelnyxLoginToken } from "@/lib/telnyx";

const bodySchema = z
  .object({
    clientInstanceId: z.string().trim().min(1).max(200),
  })
  .strict();
const paramsSchema = z.object({ sessionId: z.string().trim().min(1).max(200) });

type RouteContext = { params: Promise<{ sessionId: string }> };

type Dependencies = {
  authorize?: typeof authorizeAgentSessionCredential;
  clock?: () => Date;
  createToken?: typeof createTelnyxLoginToken;
  getActivation?: typeof resolveCallCenterActivationConfig;
  getActor: () => Promise<AgentSessionCredentialActor>;
};

export function createCanonicalAgentSessionTokenHandler({
  authorize = authorizeAgentSessionCredential,
  clock = () => new Date(),
  createToken = createTelnyxLoginToken,
  getActivation = resolveCallCenterActivationConfig,
  getActor,
}: Dependencies) {
  return withApiHandler(
    async (request: Request, context: RouteContext) => {
      const actor = await getActor();
      const parameters = paramsSchema.safeParse(await context.params);
      if (!parameters.success) throw new ApiError("Valid agent session required", 400);
      const body = await parseJsonBody(request, bodySchema);
      const activation = getActivation();
      const credential = await authorize(
        prismaAgentSessionCredentialStore,
        actor,
        {
          ...body,
          activationEnabled: activation.enabled,
          sessionId: parameters.data.sessionId,
        },
        clock(),
      );
      const token = await createToken(credential.providerCredentialId);
      return NextResponse.json({ agentLabel: credential.agentLabel, token });
    },
    {
      errorMessage: "Failed to create canonical Telnyx token",
      logLabel: "[portal-call-center] Failed to create canonical Telnyx token",
    },
  );
}
