import { withApiHandler } from "@/lib/api/handler";

import { createDirectHandoffHandler } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withApiHandler(createDirectHandoffHandler(), {
  errorMessage: "Failed to reserve direct call handoff",
  logLabel: "[direct-call-handoff] Failed to reserve handoff",
});
