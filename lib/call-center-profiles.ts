import { CallCenterSessionDirection, Prisma } from "@/generated/prisma/client";

import { phoneLookupVariants } from "@/lib/phone";
import type { PortalPracticeAccessContext } from "@/lib/portal-access";

const ABITA_PRACTICE_NAME = "Abita Eye Group";
const ABITA_SOUTH_FLORIDA_CALL_CENTER_EMAIL = "callcenter@abitaeye.com";
const ABITA_SOUTH_FLORIDA_LOCATION_NAMES = new Set(["hollywood", "sweetwater"]);
const ABITA_SOUTH_FLORIDA_QUEUE_KEY = "abita-south-florida";
const ABITA_SOUTH_FLORIDA_TRANSFER_PHONE = "+16184220360";
const ABITA_SWEETWATER_OPTICAL_EMAIL = "sweetwateropticals@abitaeye.com";
const ABITA_SWEETWATER_OPTICAL_PHONE = "+17864657479";
const ABITA_NORTH_MIAMI_BEACH_OPTICAL_PHONE = "+13055095333";
const ABITA_SWEETWATER_OPTICAL_QUEUE_KEY = "abita-sweetwater-optical";

type CallCenterProfileContext = {
  practice: { name: string };
  session: { user: { email?: string | null } };
};

type PracticeLocation = { id: string; name: string };

type PracticePhoneNumber = {
  isPrimary: boolean;
  label?: string | null;
  locationId: string | null;
  phoneNumber: string;
};

type CallCenterActivityScopeWhere = {
  AND?: CallCenterActivityScopeWhere[];
  NOT?: CallCenterActivityScopeWhere;
  OR?: CallCenterActivityScopeWhere[];
  locationId?: string | null | { in: string[] };
  session?: {
    is?: {
      toPhone?: {
        in: string[];
      };
    };
  };
};

export type CallCenterProfileLocation = {
  id: string;
  label: string;
  locationId?: string | null;
  locationIds?: string[];
  outboundNumber: string;
};

function isAbitaPractice(practice: { name: string }) {
  return practice.name.trim().toLowerCase() === ABITA_PRACTICE_NAME.toLowerCase();
}

function userEmail(context: CallCenterProfileContext) {
  return context.session.user.email?.trim().toLowerCase() ?? "";
}

export function isAbitaSouthFloridaCallCenterContext(context: CallCenterProfileContext) {
  return (
    isAbitaPractice(context.practice) &&
    userEmail(context) === ABITA_SOUTH_FLORIDA_CALL_CENTER_EMAIL
  );
}

export function isAbitaSweetwaterOpticalCallCenterContext(
  context: CallCenterProfileContext,
) {
  return (
    isAbitaPractice(context.practice) &&
    userEmail(context) === ABITA_SWEETWATER_OPTICAL_EMAIL
  );
}

export function isSpecialAbitaCallCenterContext(context: CallCenterProfileContext) {
  return (
    isAbitaSouthFloridaCallCenterContext(context) ||
    isAbitaSweetwaterOpticalCallCenterContext(context)
  );
}

export function allowsSharedCallCenterStation(
  context: CallCenterProfileContext,
  seat: { queueKey?: string | null },
) {
  return (
    isAbitaSweetwaterOpticalCallCenterContext(context) &&
    seat.queueKey === ABITA_SWEETWATER_OPTICAL_QUEUE_KEY
  );
}

function isAbitaSouthFloridaLocationName(name: string) {
  return ABITA_SOUTH_FLORIDA_LOCATION_NAMES.has(name.trim().toLowerCase());
}

function getAbitaSouthFloridaLocationIds(practice: { locations: PracticeLocation[] }) {
  return practice.locations
    .filter((location) => isAbitaSouthFloridaLocationName(location.name))
    .map((location) => location.id);
}

function isAbitaNorthMiamiBeachOpticalLocationName(name: string) {
  const normalized = name.trim().toLowerCase();
  return (
    normalized === "north miami beach optical" ||
    normalized === "brightview" ||
    normalized === "bright view"
  );
}

function isAbitaSweetwaterOpticalLocationName(name: string) {
  return (
    name.trim().toLowerCase() === "sweetwater" ||
    isAbitaNorthMiamiBeachOpticalLocationName(name)
  );
}

function abitaSweetwaterOpticalLocationLabel(name: string) {
  return isAbitaNorthMiamiBeachOpticalLocationName(name)
    ? "North Miami Beach Optical"
    : "Sweetwater Optical";
}

function getAbitaSweetwaterOpticalLocationIds(practice: {
  locations: PracticeLocation[];
}) {
  return practice.locations
    .filter((location) => isAbitaSweetwaterOpticalLocationName(location.name))
    .map((location) => location.id);
}

export function selectedCallCenterProfileLocationIds(
  location?: CallCenterProfileLocation | null,
) {
  if (!location) {
    return [];
  }

  if (location.locationIds?.length) {
    return location.locationIds;
  }

  return location.locationId ? [location.locationId] : [];
}

function selectedLocationScope(location?: CallCenterProfileLocation | null) {
  const locationIds = selectedCallCenterProfileLocationIds(location);

  if (locationIds.length) {
    return {
      locationId: {
        in: locationIds,
      },
    };
  }

  if (location && "locationId" in location) {
    return {
      locationId: location.locationId ?? null,
    };
  }

  return null;
}

function withSelectedLocationScope<T extends object>(
  scope: T,
  location?: CallCenterProfileLocation | null,
) {
  const locationScope = selectedLocationScope(location);
  return (locationScope ? { AND: [scope, locationScope] } : scope) as T;
}

function opticalPhoneVariants() {
  return [
    ...new Set(
      [ABITA_SWEETWATER_OPTICAL_PHONE, ABITA_NORTH_MIAMI_BEACH_OPTICAL_PHONE].flatMap(
        phoneLookupVariants,
      ),
    ),
  ];
}

function southFloridaTransferPhoneVariants() {
  return phoneLookupVariants(ABITA_SOUTH_FLORIDA_TRANSFER_PHONE);
}

function getAbitaSouthFloridaCallCenterLocation({
  locations,
  phoneNumbers,
}: {
  locations: PracticeLocation[];
  phoneNumbers: PracticePhoneNumber[];
}): CallCenterProfileLocation | null {
  const locationIds = getAbitaSouthFloridaLocationIds({ locations });

  if (!locationIds.length) {
    return null;
  }

  const hollywood = locations.find(
    (location) => location.name.trim().toLowerCase() === "hollywood",
  );
  const outboundNumber =
    phoneNumbers.find((phone) => phone.locationId === hollywood?.id && phone.isPrimary)
      ?.phoneNumber ??
    phoneNumbers.find(
      (phone) => phone.locationId && locationIds.includes(phone.locationId),
    )?.phoneNumber ??
    "";

  return {
    id: "abita-south-florida",
    label: "Hollywood / Sweetwater",
    locationIds,
    outboundNumber,
  };
}

function getAbitaSweetwaterOpticalCallCenterLocations({
  locations,
}: {
  locations: PracticeLocation[];
}): CallCenterProfileLocation[] {
  return locations
    .filter((location) => isAbitaSweetwaterOpticalLocationName(location.name))
    .sort((a, b) => {
      const aIsNorthMiami = isAbitaNorthMiamiBeachOpticalLocationName(a.name);
      const bIsNorthMiami = isAbitaNorthMiamiBeachOpticalLocationName(b.name);

      if (aIsNorthMiami !== bIsNorthMiami) {
        return aIsNorthMiami ? 1 : -1;
      }

      return a.name.localeCompare(b.name);
    })
    .map((location) => ({
      id: location.id,
      label: abitaSweetwaterOpticalLocationLabel(location.name),
      locationId: location.id,
      outboundNumber: ABITA_SWEETWATER_OPTICAL_PHONE,
    }));
}

export function getCallCenterProfileLocations({
  context,
  visibleLocations,
  visiblePhoneNumbers,
}: {
  context: CallCenterProfileContext;
  visibleLocations: PracticeLocation[];
  visiblePhoneNumbers: PracticePhoneNumber[];
}) {
  if (isAbitaSouthFloridaCallCenterContext(context)) {
    const southFloridaLocation = getAbitaSouthFloridaCallCenterLocation({
      locations: visibleLocations,
      phoneNumbers: visiblePhoneNumbers,
    });

    return southFloridaLocation ? [southFloridaLocation] : null;
  }

  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    const opticalLocations = getAbitaSweetwaterOpticalCallCenterLocations({
      locations: visibleLocations,
    });

    return opticalLocations.length ? opticalLocations : null;
  }

  return null;
}

export function getCallCenterProfileOutboundCallerNumbers(
  selectedLocation: CallCenterProfileLocation | null,
) {
  if (selectedLocation?.outboundNumber !== ABITA_SWEETWATER_OPTICAL_PHONE) {
    return null;
  }

  return [
    {
      label: selectedLocation.label,
      phoneNumber: ABITA_SWEETWATER_OPTICAL_PHONE,
    },
  ];
}

export function getCallCenterSeatQueueKeyForProfile(context: CallCenterProfileContext) {
  if (isAbitaSouthFloridaCallCenterContext(context)) {
    return ABITA_SOUTH_FLORIDA_QUEUE_KEY;
  }

  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return ABITA_SWEETWATER_OPTICAL_QUEUE_KEY;
  }

  return null;
}

export function buildCallCenterQueueScopeForProfile(
  context: PortalPracticeAccessContext,
  selectedLocation?: CallCenterProfileLocation | null,
): Prisma.CallCenterQueueItemWhereInput | null {
  const opticalVariants = opticalPhoneVariants();

  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return withSelectedLocationScope<Prisma.CallCenterQueueItemWhereInput>(
      {
        toPhone: {
          in: opticalVariants,
        },
      },
      selectedLocation,
    );
  }

  if (isAbitaSouthFloridaCallCenterContext(context)) {
    return {
      OR: [
        {
          toPhone: {
            in: southFloridaTransferPhoneVariants(),
          },
        },
        {
          NOT: {
            toPhone: {
              in: opticalVariants,
            },
          },
          locationId: {
            in: getAbitaSouthFloridaLocationIds(context.practice),
          },
        },
      ],
    };
  }

  return null;
}

export function buildCallCenterActivityScopeForProfile(
  context: PortalPracticeAccessContext,
  selectedLocation?: CallCenterProfileLocation | null,
): CallCenterActivityScopeWhere | null {
  const opticalVariants = opticalPhoneVariants();

  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return withSelectedLocationScope<CallCenterActivityScopeWhere>(
      {
        session: {
          is: {
            toPhone: {
              in: opticalVariants,
            },
          },
        },
      },
      selectedLocation,
    );
  }

  if (isAbitaSouthFloridaCallCenterContext(context)) {
    return {
      OR: [
        {
          session: {
            is: {
              toPhone: {
                in: southFloridaTransferPhoneVariants(),
              },
            },
          },
        },
        {
          NOT: {
            session: {
              is: {
                toPhone: {
                  in: opticalVariants,
                },
              },
            },
          },
          locationId: {
            in: getAbitaSouthFloridaLocationIds(context.practice),
          },
        },
      ],
    };
  }

  return null;
}

export function buildCallCenterSessionScopeForProfile(
  context: PortalPracticeAccessContext,
  selectedLocation?: CallCenterProfileLocation | null,
): Prisma.CallCenterSessionWhereInput | null {
  const opticalVariants = opticalPhoneVariants();

  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return withSelectedLocationScope<Prisma.CallCenterSessionWhereInput>(
      {
        toPhone: {
          in: opticalVariants,
        },
      },
      selectedLocation,
    );
  }

  if (isAbitaSouthFloridaCallCenterContext(context)) {
    return {
      OR: [
        {
          toPhone: {
            in: southFloridaTransferPhoneVariants(),
          },
        },
        {
          NOT: {
            toPhone: {
              in: opticalVariants,
            },
          },
          locationId: {
            in: getAbitaSouthFloridaLocationIds(context.practice),
          },
        },
      ],
    };
  }

  return null;
}

export function buildCallCenterPatientSessionScopeForProfile(
  context: PortalPracticeAccessContext,
  selectedLocation?: CallCenterProfileLocation | null,
): Prisma.CallCenterSessionWhereInput | null {
  const opticalVariants = opticalPhoneVariants();

  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return withSelectedLocationScope<Prisma.CallCenterSessionWhereInput>(
      {
        OR: [
          {
            direction: CallCenterSessionDirection.INBOUND,
            toPhone: {
              in: opticalVariants,
            },
          },
          {
            direction: CallCenterSessionDirection.OUTBOUND,
            fromPhone: {
              in: opticalVariants,
            },
          },
        ],
      },
      selectedLocation,
    );
  }

  return buildCallCenterSessionScopeForProfile(context, selectedLocation);
}

export function buildCallCenterNoteScopeForProfile(
  context: PortalPracticeAccessContext,
  selectedLocation?: CallCenterProfileLocation | null,
): Prisma.CallCenterNoteWhereInput | null {
  if (!isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return null;
  }

  const selectedLocationIds = selectedCallCenterProfileLocationIds(selectedLocation);
  const locationIds = selectedLocationIds.length
    ? selectedLocationIds
    : getAbitaSweetwaterOpticalLocationIds(context.practice);
  const locationScope: Prisma.CallCenterNoteWhereInput = locationIds.length
    ? {
        locationId: {
          in: locationIds,
        },
      }
    : {};
  const createdByOpticalUser: Prisma.CallCenterNoteWhereInput = {
    createdByUserId: context.session.user.id,
    ...locationScope,
  };

  return {
    OR: [
      {
        session: {
          is: buildCallCenterPatientSessionScopeForProfile(context, selectedLocation),
        },
      },
      {
        ...locationScope,
        stationSeat: {
          is: {
            queueKey: ABITA_SWEETWATER_OPTICAL_QUEUE_KEY,
          },
        },
      },
      createdByOpticalUser,
    ],
  };
}

export function getAllowedCallCenterOutboundPhoneNumbersForProfile(
  context: PortalPracticeAccessContext,
) {
  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return [{ phoneNumber: ABITA_SWEETWATER_OPTICAL_PHONE }];
  }

  if (isAbitaSouthFloridaCallCenterContext(context)) {
    const locationIds = getAbitaSouthFloridaLocationIds(context.practice);
    const opticalVariants = opticalPhoneVariants();

    return locationIds
      .flatMap((locationId) => {
        const numbers = context.allowedPhoneNumbers.filter(
          (phone) => phone.locationId === locationId,
        );
        const primary = numbers.find((phone) => phone.isPrimary) ?? numbers[0] ?? null;

        return primary ? [{ phoneNumber: primary.phoneNumber }] : [];
      })
      .filter(
        (phone) =>
          !phoneLookupVariants(phone.phoneNumber).some((variant) =>
            opticalVariants.includes(variant),
          ),
      );
  }

  return null;
}

export function buildCallCenterSeatAccessWhereForProfile(
  context: PortalPracticeAccessContext,
): Prisma.CallCenterAgentSeatWhereInput | null {
  if (isAbitaSouthFloridaCallCenterContext(context)) {
    return {
      queueKey: ABITA_SOUTH_FLORIDA_QUEUE_KEY,
    };
  }

  if (isAbitaSweetwaterOpticalCallCenterContext(context)) {
    return {
      queueKey: ABITA_SWEETWATER_OPTICAL_QUEUE_KEY,
    };
  }

  return null;
}
