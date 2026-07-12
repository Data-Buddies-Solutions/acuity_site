import { isAdminEmail } from "@/lib/admin-auth";
import { getAuthSession } from "@/lib/auth";
import {
  runCallCenterActivationPreflight,
  type CallCenterActivationPreflightResult,
} from "@/lib/call-center/application/call-center-activation-preflight";
import { prismaCallCenterActivationPreflightStore } from "@/lib/call-center/infrastructure/prisma-call-center-activation-preflight";
import { assertCallCenterActivationPrerequisites } from "@/lib/call-center/infrastructure/call-center-activation-config";

type ActivationPreflightHandlerDependencies = {
  clock?: () => Date;
  getSession?: () => Promise<{ user?: { email?: string | null } } | null>;
  isAdmin?: (email?: string | null) => boolean;
  runPreflight?: (
    testEndpointId: string,
    now: Date,
  ) => Promise<CallCenterActivationPreflightResult>;
};

export function createActivationPreflightHandler({
  clock = () => new Date(),
  getSession = () => getAuthSession(),
  isAdmin = isAdminEmail,
  runPreflight = (testEndpointId, now) =>
    runCallCenterActivationPreflight(prismaCallCenterActivationPreflightStore, {
      now,
      runtimeConfigReady: () => {
        assertCallCenterActivationPrerequisites();
        return true;
      },
      testEndpointId,
    }),
}: ActivationPreflightHandlerDependencies = {}) {
  return async function GET(request: Request) {
    const session = await getSession();
    if (!isAdmin(session?.user?.email)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const testEndpointId = new URL(request.url).searchParams
      .get("testEndpointId")
      ?.trim();
    if (!testEndpointId) {
      return Response.json({ error: "testEndpointId is required" }, { status: 400 });
    }

    const result = await runPreflight(testEndpointId, clock());
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  };
}
