import { drainProviderWebhooks } from "@/lib/call-center/application/provider-webhook-runtime";

type Drain = typeof drainProviderWebhooks;

export function createProviderWebhookDrainHandler({
  drain = drainProviderWebhooks,
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

export const GET = createProviderWebhookDrainHandler();
