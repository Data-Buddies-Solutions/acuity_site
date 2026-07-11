import { createConfigurationHandlers } from "./handler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

const handlers = createConfigurationHandlers();

export const GET = handlers.GET;
export const PUT = handlers.PUT;
