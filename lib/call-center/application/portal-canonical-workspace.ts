import { listAccessibleQueues } from "@/lib/call-center/auth/queue-access";
import { readCanonicalNeedsAction } from "@/lib/call-center/application/portal-canonical-history";
import type { PortalCallCenterLocation } from "@/lib/call-center/portal-model";
import { prisma } from "@/lib/prisma";
import { getPracticeBranding } from "@/lib/practice-branding";
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
  selectedQueueId?: string,
) {
  const matches = listCanonicalWorkspaceQueues(queues, selectedLocationIds);
  return matches.find(({ id }) => id === selectedQueueId) ?? matches[0] ?? null;
}

export function listCanonicalWorkspaceQueues(
  queues: AccessibleQueue[],
  selectedLocationIds: string[],
) {
  const selected = new Set(selectedLocationIds);
  return queues.filter(
    (queue) =>
      selected.size === 0 ||
      queue.locations.length === 0 ||
      queue.locations.some(({ locationId }) => selected.has(locationId)),
  );
}

export async function readPortalCanonicalWorkspace(
  selectedLocationIds: string[],
  selectedQueueId?: string,
) {
  const context = await getCurrentPortalPracticeContext();
  if (!context) return null;

  const queues = await listAccessibleQueues({
    allowedLocationIds: context.allowedLocationIds,
    hasAllLocationAccess: context.hasAllLocationAccess,
    practiceId: context.practice.id,
    userId: context.session.user.id,
  });
  const availableQueues = listCanonicalWorkspaceQueues(queues, selectedLocationIds);
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
    outboundNumbers,
    queueId: queue.id,
  };
}

function portalLocations(
  context: NonNullable<Awaited<ReturnType<typeof getCurrentPortalPracticeContext>>>,
): PortalCallCenterLocation[] {
  const allowed = new Set(context.allowedLocationIds);
  const visible = context.hasAllLocationAccess
    ? context.practice.locations
    : context.practice.locations.filter(({ id }) => allowed.has(id));
  return visible.map(({ id, name }) => ({
    id,
    label: name,
    locationId: id,
    locationIds: [id],
  }));
}

export async function readPortalCallCenterPage(
  selectedLocationId?: string,
  selectedQueueId?: string,
) {
  const shell = await readPortalCallCenterShell(selectedLocationId);
  if (!shell) return null;

  const selectedLocationIds = shell.selectedLocation ? [shell.selectedLocation.id] : [];
  const workspace = await readPortalCanonicalWorkspace(
    selectedLocationIds,
    selectedQueueId,
  );
  const needsAction = workspace
    ? await readCanonicalNeedsAction({
        locationIds: selectedLocationIds,
        page: 1,
        pageSize: 25,
        queueId: workspace.queueId,
      })
    : null;

  return {
    ...shell,
    needsAction: needsAction?.groups ?? [],
    needsActionCount: needsAction?.total ?? 0,
    workspace,
  };
}

export async function readPortalCallCenterShell(selectedLocationId?: string) {
  const context = await getCurrentPortalPracticeContext();
  if (!context) return null;

  const locations = portalLocations(context);
  const selectedLocation =
    locations.find(({ id }) => id === selectedLocationId) ?? locations[0] ?? null;
  return {
    branding: getPracticeBranding(context.practice),
    locations,
    practiceName: context.practice.name,
    selectedLocation,
  };
}
