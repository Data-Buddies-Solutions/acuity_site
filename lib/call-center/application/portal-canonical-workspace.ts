import { listAccessibleQueues } from "@/lib/call-center/auth/queue-access";
import { prisma } from "@/lib/prisma";
import { getCurrentPortalPracticeContext } from "@/lib/portal-access";

type AccessibleQueue = Awaited<ReturnType<typeof listAccessibleQueues>>[number];

export type CanonicalOutboundNumber = {
  id: string;
  label: string;
  locationId: string | null;
  phoneNumber: string;
};

export async function listCanonicalOutboundNumbers(
  actor: {
    allowedLocationIds: string[];
    hasAllLocationAccess: boolean;
    practiceId: string;
  },
  queue: AccessibleQueue,
  database: Pick<typeof prisma, "callCenterNumber"> = prisma,
): Promise<CanonicalOutboundNumber[]> {
  const queueLocationIds = queue.locations.map(({ locationId }) => locationId);
  const locationIds = actor.hasAllLocationAccess
    ? queueLocationIds
    : queueLocationIds.filter((id) => actor.allowedLocationIds.includes(id));
  if (queueLocationIds.length > 0 && !locationIds.length) return [];

  const numbers = await database.callCenterNumber.findMany({
    orderBy: [
      { practicePhoneNumber: { label: "asc" } },
      { practicePhoneNumber: { phoneNumber: "asc" } },
      { id: "asc" },
    ],
    select: {
      id: true,
      practicePhoneNumber: {
        select: { label: true, locationId: true, phoneNumber: true },
      },
    },
    where: {
      enabled: true,
      outboundEnabled: true,
      practiceId: actor.practiceId,
      practicePhoneNumber: {
        practiceId: actor.practiceId,
        ...(actor.hasAllLocationAccess && queueLocationIds.length === 0
          ? {}
          : {
              locationId: {
                in: queueLocationIds.length ? locationIds : actor.allowedLocationIds,
              },
            }),
      },
    },
  });
  return numbers.map(({ id, practicePhoneNumber }) => ({
    id,
    label: practicePhoneNumber.label || practicePhoneNumber.phoneNumber,
    locationId: practicePhoneNumber.locationId,
    phoneNumber: practicePhoneNumber.phoneNumber,
  }));
}

export function selectCanonicalWorkspaceQueue(
  queues: AccessibleQueue[],
  selectedLocationIds: string[],
  canonicalActivation = false,
  drainingQueueIds: ReadonlySet<string> = new Set(),
  selectedQueueId?: string,
) {
  const matches = listCanonicalWorkspaceQueues(
    queues,
    selectedLocationIds,
    canonicalActivation,
    drainingQueueIds,
  );
  return matches.find(({ id }) => id === selectedQueueId) ?? matches[0] ?? null;
}

export function listCanonicalWorkspaceQueues(
  queues: AccessibleQueue[],
  selectedLocationIds: string[],
  canonicalActivation = false,
  drainingQueueIds: ReadonlySet<string> = new Set(),
) {
  const selected = new Set(selectedLocationIds);
  const drainingQueues = queues.filter(({ id }) => drainingQueueIds.has(id));
  const canonicalQueues = canonicalActivation
    ? queues
    : drainingQueues.length
      ? drainingQueues
      : queues.filter(({ routingMode }) => routingMode === "SHADOW");
  return canonicalQueues.filter(
    (queue) =>
      selected.size === 0 ||
      queue.locations.length === 0 ||
      queue.locations.some(({ locationId }) => selected.has(locationId)),
  );
}

export async function readPortalCanonicalWorkspace(
  selectedLocationIds: string[],
  canonicalActivation = false,
  selectedQueueId?: string,
) {
  const context = await getCurrentPortalPracticeContext();
  if (!context?.practice.callCenterSettings?.enabled) return null;

  const queues = await listAccessibleQueues({
    allowedLocationIds: context.allowedLocationIds,
    hasAllLocationAccess: context.hasAllLocationAccess,
    practiceId: context.practice.id,
    userId: context.session.user.id,
  });
  const drainingQueueIds = canonicalActivation
    ? new Set<string>()
    : new Set(
        (
          await prisma.callCenterCall.findMany({
            distinct: ["queueId"],
            select: { queueId: true },
            where: {
              effectOwner: "CANONICAL",
              practiceId: context.practice.id,
              queueId: { in: queues.map(({ id }) => id) },
              status: {
                in: ["RECEIVED", "QUEUED", "RINGING", "CONNECTED", "WRAP_UP"],
              },
            },
          })
        )
          .map(({ queueId }) => queueId)
          .filter((queueId): queueId is string => Boolean(queueId)),
      );
  const availableQueues = listCanonicalWorkspaceQueues(
    queues,
    selectedLocationIds,
    canonicalActivation,
    drainingQueueIds,
  );
  const queue =
    availableQueues.find(({ id }) => id === selectedQueueId) ??
    availableQueues[0] ??
    null;
  if (!queue) return null;
  const outboundNumbers = await listCanonicalOutboundNumbers(
    {
      allowedLocationIds: context.allowedLocationIds,
      hasAllLocationAccess: context.hasAllLocationAccess,
      practiceId: context.practice.id,
    },
    queue,
  );
  return {
    availableQueues: availableQueues.map(({ id, name }) => ({ id, name })),
    drainingCanonical: !canonicalActivation && drainingQueueIds.has(queue.id),
    outboundNumbers,
    queueId: queue.id,
    routingMode: queue.routingMode,
  };
}
