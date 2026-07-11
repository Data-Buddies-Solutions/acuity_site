import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import {
  buildLegacyCallCenterBackfillReport,
  type LegacyCallCenterBackfillReport,
  type LegacyCallCenterBackfillSnapshot,
} from "@/lib/call-center/application/legacy-backfill-plan";
import {
  getCallCenterProfileLocations,
  getCallCenterSeatQueueKeyForProfile,
  selectedCallCenterProfileLocationIds,
} from "@/lib/call-center-profiles";
import { prisma } from "@/lib/prisma";

const legacyBackfillSelect = {
  id: true,
  name: true,
  _count: {
    select: {
      callCenterEndpoints: true,
      callCenterNumbers: true,
      callCenterQueues: true,
    },
  },
  callCenterSettings: {
    select: {
      enabled: true,
      inboundPhoneNumber: true,
      outboundCallerNumber: true,
      recordingEnabled: true,
      telnyxConnectionId: true,
      telnyxCredentialId: true,
      voicemailGreeting: true,
      voicemailTimeoutSec: true,
    },
  },
  phoneNumbers: {
    select: {
      id: true,
      isPrimary: true,
      locationId: true,
      phoneNumber: true,
    },
  },
  locations: {
    select: {
      id: true,
      name: true,
    },
  },
  callCenterAgentSeats: {
    select: {
      id: true,
      enabled: true,
      locationId: true,
      queueKey: true,
      telnyxCredentialId: true,
      sipUsername: true,
    },
  },
  memberships: {
    select: {
      locationScope: true,
      locations: {
        select: {
          locationId: true,
        },
      },
      userId: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  },
} satisfies Prisma.PracticeSelect;

type LegacyBackfillPractice = Prisma.PracticeGetPayload<{
  select: typeof legacyBackfillSelect;
}>;

export type LegacyBackfillReadClient = Pick<PrismaClient, "practice">;

export function resolveLegacyProfileQueueKey(practiceName: string, userEmail: string) {
  // Reuse the current profile owner instead of copying profile constants into
  // migration code. This is the same narrow adapter used by legacy routing.
  return getCallCenterSeatQueueKeyForProfile(
    legacyProfileContext(practiceName, userEmail),
  );
}

function legacyProfileContext(practiceName: string, userEmail: string) {
  return {
    practice: { name: practiceName },
    session: { user: { email: userEmail } },
  };
}

function toSnapshot(practice: LegacyBackfillPractice): LegacyCallCenterBackfillSnapshot {
  return {
    practiceId: practice.id,
    locationIds: practice.locations.map(({ id }) => id),
    existingGenericConfiguration: {
      endpointCount: practice._count.callCenterEndpoints,
      numberCount: practice._count.callCenterNumbers,
      queueCount: practice._count.callCenterQueues,
    },
    settings: practice.callCenterSettings,
    phoneNumbers: practice.phoneNumbers,
    seats: practice.callCenterAgentSeats.map(({ telnyxCredentialId, ...seat }) => ({
      ...seat,
      providerCredentialId: telnyxCredentialId,
    })),
    profileAssignments: practice.memberships.flatMap((membership) => {
      const { userId, user } = membership;
      const context = legacyProfileContext(practice.name, user.email);
      const queueKey = getCallCenterSeatQueueKeyForProfile(context);
      if (!queueKey) return [];
      const grantedLocationIds =
        membership.locationScope === "ALL"
          ? new Set(practice.locations.map(({ id }) => id))
          : new Set(membership.locations.map(({ locationId }) => locationId));
      const profileLocations = getCallCenterProfileLocations({
        context,
        visibleLocations: practice.locations.filter(({ id }) =>
          grantedLocationIds.has(id),
        ),
        visiblePhoneNumbers: practice.phoneNumbers.filter(
          ({ locationId }) => !locationId || grantedLocationIds.has(locationId),
        ),
      });
      return [
        {
          locationIds: [
            ...new Set(
              (profileLocations ?? []).flatMap(selectedCallCenterProfileLocationIds),
            ),
          ].sort(),
          queueKey,
          userId,
        },
      ];
    }),
    runtimeFallbacks: {
      connection: Boolean(process.env.TELNYX_CONNECTION_ID?.trim()),
      credential: Boolean(process.env.TELNYX_CREDENTIAL_ID?.trim()),
      inboundNumber: Boolean(process.env.TELNYX_INBOUND_NUMBER?.trim()),
      outboundNumber: Boolean(process.env.TELNYX_PHONE_NUMBER?.trim()),
    },
  };
}

export async function readLegacyCallCenterBackfillReport(
  practiceId: string,
  client: LegacyBackfillReadClient = prisma,
): Promise<LegacyCallCenterBackfillReport | null> {
  const practice = await client.practice.findUnique({
    select: legacyBackfillSelect,
    where: { id: practiceId },
  });
  return practice ? buildLegacyCallCenterBackfillReport(toSnapshot(practice)) : null;
}
