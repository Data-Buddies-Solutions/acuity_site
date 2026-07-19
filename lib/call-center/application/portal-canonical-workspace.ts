import {
  listAccessibleQueues,
  type QueueAccessActor,
} from "@/lib/call-center/auth/queue-access";
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

export type CanonicalAgentProfile = {
  id: string;
  label: string;
  locationId: string | null;
};

async function readCanonicalAgentProfile(
  actor: QueueAccessActor,
  queue: AccessibleQueue,
  database: Pick<typeof prisma, "callCenterEndpoint"> = prisma,
): Promise<CanonicalAgentProfile | null> {
  const queueLocationIds = queue.locations.map(({ locationId }) => locationId);
  const locationIds = actor.hasAllLocationAccess
    ? queueLocationIds
    : queueLocationIds.filter((id) => actor.allowedLocationIds.includes(id));

  return database.callCenterEndpoint.findFirst({
    orderBy: [{ label: "asc" }, { id: "asc" }],
    select: { id: true, label: true, locationId: true },
    where: {
      enabled: true,
      practiceId: actor.practiceId,
      userId: actor.userId,
      ...(queueLocationIds.length
        ? { locationId: { in: locationIds } }
        : actor.hasAllLocationAccess
          ? {}
          : { locationId: { in: actor.allowedLocationIds } }),
    },
  });
}

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

  return readPortalCanonicalWorkspaceForContext(
    context,
    selectedLocationIds,
    selectedQueueId,
  );
}

async function readPortalCanonicalWorkspaceForContext(
  context: NonNullable<Awaited<ReturnType<typeof getCurrentPortalPracticeContext>>>,
  selectedLocationIds: string[],
  selectedQueueId?: string,
) {
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
  const actor = {
    allowedLocationIds: context.allowedLocationIds,
    hasAllLocationAccess: context.hasAllLocationAccess,
    practiceId: context.practice.id,
    userId: context.session.user.id,
  };
  const [agentProfile, outboundNumbers] = await Promise.all([
    readCanonicalAgentProfile(actor, queue),
    listCanonicalOutboundNumbers(actor, queue),
  ]);
  return {
    agentProfile,
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
  const context = await getCurrentPortalPracticeContext();
  if (!context) return null;

  const locations = portalLocations(context);
  const selectedLocation =
    locations.find(({ id }) => id === selectedLocationId) ?? locations[0] ?? null;
  const selectedLocationIds = selectedLocation ? [selectedLocation.id] : [];
  const workspace = await readPortalCanonicalWorkspaceForContext(
    context,
    selectedLocationIds,
    selectedQueueId,
  );

  return {
    branding: getPracticeBranding(context.practice),
    launched:
      Boolean(context.practice.launchedAt) ||
      context.practice.onboardingStatus === "LIVE",
    locations,
    practiceName: context.practice.name,
    selectedLocation,
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
