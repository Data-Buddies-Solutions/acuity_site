import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, parseJsonBody } from "@/lib/api/handler";
import { type AgentSessionCredentialActor } from "@/lib/call-center/application/agent-session-credentials";
import { callCenter } from "@/lib/call-center/call-center";
import { createTelnyxLoginToken } from "@/lib/telnyx";
import { withCallCenterApiHandler } from "@/lib/call-center/operator-error-response";

const bodySchema = z
  .object({
    clientInstanceId: z.string().trim().min(1).max(200),
  })
  .strict();
const paramsSchema = z.object({ sessionId: z.string().trim().min(1).max(200) });

type RouteContext = { params: Promise<{ sessionId: string }> };

type Dependencies = {
  authorize?: typeof callCenter.authorizeAgentCredential;
  clock?: () => Date;
  createToken?: typeof createTelnyxLoginToken;
  getActor: () => Promise<AgentSessionCredentialActor>;
};

export function createCanonicalAgentSessionTokenHandler({
  authorize = callCenter.authorizeAgentCredential,
  clock = () => new Date(),
  createToken = createTelnyxLoginToken,
  getActor,
}: Dependencies) {
  return withCallCenterApiHandler(
    async (request: Request, context: RouteContext) => {
      const actor = await getActor();
      const parameters = paramsSchema.safeParse(await context.params);
      if (!parameters.success) throw new ApiError("Valid agent session required", 400);
      const body = await parseJsonBody(request, bodySchema);
      const credential = await authorize(
        actor,
        { ...body, sessionId: parameters.data.sessionId },
        clock(),
      );
      const token = await createToken(credential.providerCredentialId);
      return NextResponse.json({ agentLabel: credential.agentLabel, token });
    },
    {
      errorCode: "PROVIDER_UNAVAILABLE",
      logLabel: "[portal-call-center] Failed to create canonical Telnyx token",
      retryable: true,
    },
  );
}
