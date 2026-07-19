import { NextResponse } from "next/server";

import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";
import { readCallCenterSnapshot } from "@/lib/call-center/application/realtime-queries";
import { callCenter } from "@/lib/call-center/call-center";
import { CallCenterOperatorError } from "@/lib/call-center/operator-error-response";

type Dependencies = {
  getActor: () => Promise<QueueAccessActor>;
  readSnapshot?: typeof readCallCenterSnapshot;
};

export function createSnapshotHandler({
  getActor,
  readSnapshot = callCenter.readOperatorState,
}: Dependencies) {
  return async function GET(request: Request) {
    const parameters = new URL(request.url).searchParams;
    const queueId = parameters.get("queueId")?.trim();
    if (!queueId) {
      throw new CallCenterOperatorError("INVALID_REQUEST", 400);
    }

    return NextResponse.json(await readSnapshot(await getActor(), queueId));
  };
}
