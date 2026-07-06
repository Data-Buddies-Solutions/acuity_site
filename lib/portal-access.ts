import { Prisma } from "@/generated/prisma/client";
import { cache } from "react";

import { getAuthSession } from "@/lib/auth";
import { phoneNationalDigits } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

const portalPracticeAccessInclude = {
  callCenterSettings: true,
  locations: {
    orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }],
  },
  phoneNumbers: {
    include: {
      location: true,
    },
    orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }],
  },
} satisfies Prisma.PracticeInclude;

const portalMembershipAccessInclude = {
  locations: {
    include: {
      location: true,
    },
    orderBy: {
      createdAt: "asc" as const,
    },
  },
  practice: {
    include: portalPracticeAccessInclude,
  },
} satisfies Prisma.PracticeMembershipInclude;

export type PortalPracticeAccessContext = {
  allowedLocationIds: string[];
  allowedPhoneNumbers: PortalPracticeAccessPractice["phoneNumbers"];
  hasAllLocationAccess: boolean;
  membership: PortalPracticeAccessMembership;
  practice: PortalPracticeAccessPractice;
  session: NonNullable<Awaited<ReturnType<typeof getAuthSession>>>;
};

type PortalPracticeAccessMembership = Prisma.PracticeMembershipGetPayload<{
  include: typeof portalMembershipAccessInclude;
}>;

type PortalPracticeAccessPractice = PortalPracticeAccessMembership["practice"];

export function portalPhoneLookupVariants(phone: string | null | undefined) {
  const digits = phoneNationalDigits(phone);
  const variants = new Set<string>();

  if (!digits) {
    return [];
  }

  variants.add(digits);

  if (digits.length === 10) {
    variants.add(`1${digits}`);
    variants.add(`+1${digits}`);
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    variants.add(digits.slice(1));
  }

  return [...variants].filter(Boolean);
}

function getAllowedLocationIds(membership: PortalPracticeAccessMembership) {
  if (membership.locationScope !== "SELECTED") {
    return membership.practice.locations.map((location) => location.id);
  }

  const practiceLocationIds = new Set(
    membership.practice.locations.map((location) => location.id),
  );

  return [
    ...new Set(
      membership.locations
        .map((grant) => grant.locationId)
        .filter((locationId) => practiceLocationIds.has(locationId)),
    ),
  ];
}

export function filterPortalLocationsForAccess<Location extends { id: string }>(
  context: PortalPracticeAccessContext,
  locations: Location[],
) {
  if (context.hasAllLocationAccess) {
    return locations;
  }

  const allowed = new Set(context.allowedLocationIds);
  return locations.filter((location) => allowed.has(location.id));
}

export function filterPortalPhoneNumbersForAccess<
  PhoneNumber extends { locationId: string | null },
>(context: PortalPracticeAccessContext, phoneNumbers: PhoneNumber[]) {
  if (context.hasAllLocationAccess) {
    return phoneNumbers;
  }

  const allowed = new Set(context.allowedLocationIds);
  return phoneNumbers.filter(
    (phoneNumber) => phoneNumber.locationId && allowed.has(phoneNumber.locationId),
  );
}

export function canAccessPortalLocation(
  context: PortalPracticeAccessContext,
  locationId: string | null | undefined,
) {
  if (context.hasAllLocationAccess) {
    return true;
  }

  return Boolean(locationId && context.allowedLocationIds.includes(locationId));
}

export function buildPortalLocationScopeWhere(context: PortalPracticeAccessContext) {
  if (context.hasAllLocationAccess) {
    return {};
  }

  return {
    locationId: {
      in: context.allowedLocationIds,
    },
  };
}

export function buildPortalAgentCallScopeWhere(
  context: PortalPracticeAccessContext,
): Prisma.AgentCallWhereInput {
  if (context.hasAllLocationAccess) {
    return {};
  }

  const clauses: Prisma.AgentCallWhereInput[] = [];
  const officePhoneVariants = [
    ...new Set(
      context.allowedPhoneNumbers.flatMap((phone) =>
        portalPhoneLookupVariants(phone.phoneNumber),
      ),
    ),
  ];

  if (context.allowedLocationIds.length) {
    clauses.push({
      locationId: {
        in: context.allowedLocationIds,
      },
    });
  }

  if (officePhoneVariants.length) {
    clauses.push({
      officePhone: {
        in: officePhoneVariants,
      },
    });
  }

  return clauses.length ? { OR: clauses } : { id: { in: [] } };
}

export function buildPortalAgentCallScopeSql(context: PortalPracticeAccessContext) {
  if (context.hasAllLocationAccess) {
    return Prisma.sql`TRUE`;
  }

  const clauses: Prisma.Sql[] = [];
  const officePhoneVariants = [
    ...new Set(
      context.allowedPhoneNumbers.flatMap((phone) =>
        portalPhoneLookupVariants(phone.phoneNumber),
      ),
    ),
  ];

  if (context.allowedLocationIds.length) {
    clauses.push(
      Prisma.sql`"locationId" IN (${Prisma.join(context.allowedLocationIds)})`,
    );
  }

  if (officePhoneVariants.length) {
    clauses.push(Prisma.sql`"officePhone" IN (${Prisma.join(officePhoneVariants)})`);
  }

  return clauses.length
    ? Prisma.sql`(${Prisma.join(clauses, " OR ")})`
    : Prisma.sql`FALSE`;
}

async function readCurrentPortalPracticeContext(): Promise<PortalPracticeAccessContext | null> {
  const session = await getAuthSession();

  if (!session) {
    return null;
  }

  const membership = await prisma.practiceMembership.findFirst({
    include: portalMembershipAccessInclude,
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    where: {
      userId: session.user.id,
    },
  });

  if (!membership) {
    return null;
  }

  const hasAllLocationAccess = membership.locationScope !== "SELECTED";
  const allowedLocationIds = getAllowedLocationIds(membership);
  const context = {
    allowedLocationIds,
    allowedPhoneNumbers: [] as PortalPracticeAccessPractice["phoneNumbers"],
    hasAllLocationAccess,
    membership,
    practice: membership.practice,
    session,
  };

  return {
    ...context,
    allowedPhoneNumbers: filterPortalPhoneNumbersForAccess(
      context,
      membership.practice.phoneNumbers,
    ),
  };
}

export const getCurrentPortalPracticeContext = cache(readCurrentPortalPracticeContext);
