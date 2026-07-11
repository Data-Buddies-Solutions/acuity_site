import { NextResponse } from "next/server";

import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { QueueAccessError } from "@/lib/call-center/auth/queue-access";
import { readCallCenterSnapshot } from "@/lib/call-center/application/realtime-queries";

type Dependencies = {
  getActor: () => Promise<QueueAccessActor>;
  readSnapshot?: typeof readCallCenterSnapshot;
};

export function createSnapshotHandler({
  getActor,
  readSnapshot = readCallCenterSnapshot,
}: Dependencies) {
  return async function GET(request: Request) {
    try {
      const queueId = new URL(request.url).searchParams.get("queueId")?.trim();
      if (!queueId) {
        return NextResponse.json({ error: "queueId is required" }, { status: 400 });
      }

      return NextResponse.json(await readSnapshot(await getActor(), queueId));
    } catch (error) {
      if (error instanceof QueueAccessError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  };
}
