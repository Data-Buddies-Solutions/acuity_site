import { createAgentSessionHandlers } from "./handler";

export const dynamic = "force-dynamic";

const handlers = createAgentSessionHandlers();

export const POST = handlers.POST;
