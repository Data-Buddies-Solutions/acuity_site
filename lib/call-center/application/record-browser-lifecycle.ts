import type { QueueAccessActor } from "@/lib/call-center/auth/queue-access";

export const MAX_BROWSER_LIFECYCLE_BATCH_SIZE = 20;

export type BrowserLifecycleEvent = {
  agentSessionId: string;
  answerOperationId?: string;
  answerOutcome?: "FAILED" | "SUCCEEDED";
  browserClientInstanceId: string;
  callId: string | null;
  callLegId: string | null;
  category:
    | "ANSWER_FAILED"
    | "ANSWER_SUCCEEDED"
    | "REATTACH_CORRELATION_FAILED"
    | "REATTACH_FAILED"
    | "REATTACH_SUCCEEDED"
    | "SDK_READY"
    | "SIGNALING_INTERRUPTED";
  connectionGeneration: number;
  connectionId: string;
  connectionState: "CONNECTING" | "FAILED" | "OFFLINE" | "READY";
  datacenter: string | null;
  deploymentRevision: string | null;
  errorCode?: string;
  errorFatal?: boolean;
  errorName?: string;
  eventId: string;
  occurredAt: string;
  providerCallControlId: string | null;
  providerCallLegId: string | null;
  providerCallSessionId: string | null;
  recoveredCallId: string | null;
  region: string | null;
  sdkCallId: string | null;
  sdkCallState: string | null;
  sdkVersion: string;
};

export interface BrowserLifecycleStore {
  save(
    actor: QueueAccessActor,
    events: readonly BrowserLifecycleEvent[],
  ): Promise<number>;
}

export class BrowserLifecycleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BrowserLifecycleError";
  }
}

export async function recordBrowserLifecycle(
  store: BrowserLifecycleStore,
  actor: QueueAccessActor,
  events: readonly BrowserLifecycleEvent[],
) {
  if (events.length < 1 || events.length > MAX_BROWSER_LIFECYCLE_BATCH_SIZE) {
    throw new BrowserLifecycleError("Browser lifecycle batch is outside bounds", 400);
  }
  return { accepted: await store.save(actor, events) };
}
