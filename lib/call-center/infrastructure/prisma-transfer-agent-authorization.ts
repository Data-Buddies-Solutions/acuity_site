import type { Prisma } from "@/generated/prisma/client";

export function sameLocationTransferMembershipWhere({
  locationId,
  practiceId,
  userId,
}: {
  locationId: string;
  practiceId: string;
  userId?: string;
}): Prisma.CallCenterQueueMemberWhereInput {
  return {
    enabled: true,
    queue: {
      enabled: true,
      OR: [{ locations: { none: {} } }, { locations: { some: { locationId } } }],
      practiceId,
    },
    role: "AGENT",
    ...(userId ? { userId } : {}),
  };
}
