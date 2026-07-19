import { drainProviderCommands } from "@/lib/call-center/application/provider-command-runtime";

type Drain = typeof drainProviderCommands;

export function createProviderCommandDrainHandler({
  drain = drainProviderCommands,
  secret = process.env.CRON_SECRET,
}: {
  drain?: Drain;
  secret?: string;
} = {}) {
  return async function GET(request: Request) {
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    return Response.json({ ok: true, ...(await drain()) });
  };
}

export const GET = createProviderCommandDrainHandler();
