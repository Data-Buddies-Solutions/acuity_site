import { listAccessibleQueues } from "@/lib/call-center/auth/queue-access";
import { getCurrentPortalPracticeContext } from "@/lib/portal-access";

type AccessibleQueue = Awaited<ReturnType<typeof listAccessibleQueues>>[number];

export function selectCanonicalWorkspaceQueue(
  queues: AccessibleQueue[],
  selectedLocationIds: string[],
) {
  const selected = new Set(selectedLocationIds);
  const shadowQueues = queues.filter(({ routingMode }) => routingMode === "SHADOW");
  const matches = selected.size
    ? shadowQueues.filter((queue) =>
        queue.locations.some(({ locationId }) => selected.has(locationId)),
      )
    : shadowQueues.filter(({ locations }) => locations.length === 0);
  return matches.length === 1 ? matches[0] : null;
}

export async function readPortalCanonicalWorkspace(selectedLocationIds: string[]) {
  const context = await getCurrentPortalPracticeContext();
  if (!context?.practice.callCenterSettings?.enabled) return null;

  const queues = await listAccessibleQueues({
    allowedLocationIds: context.allowedLocationIds,
    hasAllLocationAccess: context.hasAllLocationAccess,
    practiceId: context.practice.id,
    userId: context.session.user.id,
  });
  const queue = selectCanonicalWorkspaceQueue(queues, selectedLocationIds);
  return queue ? { queueId: queue.id, routingMode: queue.routingMode } : null;
}
