import { createCallCenterRecoveryHandler } from "./handler";

export const dynamic = "force-dynamic";
export const maxDuration = 55;
export const runtime = "nodejs";

export const GET = createCallCenterRecoveryHandler();
