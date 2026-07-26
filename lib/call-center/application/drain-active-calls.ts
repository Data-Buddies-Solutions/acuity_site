export type DueActiveCall = {
  callId: string;
  direction: "INBOUND" | "OUTBOUND";
  practiceId: string;
  status: "QUEUED" | "RECEIVED" | "RINGING" | "VOICEMAIL";
};

type ReconciliationResult = {
  status: "APPLIED" | "SKIPPED";
};

export function createActiveCallDrainer({
  backlog,
  clock = () => new Date(),
  concurrency = 4,
  limit = 20,
  reconcile,
}: {
  backlog: {
    listDue(limit: number, now: Date): Promise<DueActiveCall[]>;
    recordFailure?(call: DueActiveCall, now: Date): Promise<void>;
  };
  clock?: () => Date;
  concurrency?: number;
  limit?: number;
  reconcile(call: DueActiveCall, now: Date): Promise<ReconciliationResult>;
}) {
  return async function drainActiveCalls() {
    const now = clock();
    const calls = await backlog.listDue(limit, now);
    const groups = new Map<string, DueActiveCall[]>();
    for (const call of calls) {
      const group = groups.get(call.practiceId) ?? [];
      group.push(call);
      groups.set(call.practiceId, group);
    }

    const pendingGroups = [...groups.values()];
    let nextGroup = 0;
    let failed = 0;
    let recovered = 0;

    async function worker() {
      while (nextGroup < pendingGroups.length) {
        const group = pendingGroups[nextGroup];
        nextGroup += 1;
        if (!group) return;
        for (const call of group) {
          try {
            const result = await reconcile(call, now);
            if (result.status === "APPLIED") recovered += 1;
          } catch {
            failed += 1;
            try {
              await backlog.recordFailure?.(call, now);
            } catch {
              // The next minute sweep will retry if failure rotation cannot persist.
            }
          }
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(Math.max(1, Math.floor(concurrency)), pendingGroups.length) },
        () => worker(),
      ),
    );

    return { attempted: calls.length, failed, recovered };
  };
}
