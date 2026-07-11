import { createAgentSessionHandlers } from "../handler";

export const dynamic = "force-dynamic";

const handlers = createAgentSessionHandlers();

export const DELETE = handlers.DELETE;
export const PATCH = handlers.PATCH;
