import type { Prisma } from "@/generated/prisma/client";

import type { PracticeWebsiteScanResult } from "./practice-records";
import { getPracticeBranding, type PracticeBranding } from "./practice-branding";
import { prisma } from "./prisma";

export type PracticeProviderDraft = {
  id?: string;
  providerHours: string;
  providerLocation: string;
  providerName: string;
  providerNpi: string;
  providerSchedulingNotes: string;
  providerSpecialty: string;
};

export type PracticeLocationDraft = {
  address: string;
  fax: string;
  hours: string;
  id?: string;
  insuranceNotes: string;
  insuranceVaries: boolean;
  knowledgeNotes: string;
  knowledgeVaries: boolean;
  locationName: string;
  phone: string;
};

export type PracticeWorkspaceDraft = {
  address: string;
  fax: string;
  insuranceAcceptedPlans: string;
  insuranceExceptions: string;
  insuranceTransferRules: string;
  knowledgeAfterHours: string;
  knowledgeAppointmentPrep: string;
  knowledgeCommonQuestions: string;
  knowledgeOfficePolicies: string;
  knowledgePhrases: string;
  locations: PracticeLocationDraft[];
  locationName: string;
  phone: string;
  practiceName: string;
  providers: PracticeProviderDraft[];
  providerHours: string;
  providerLocation: string;
  providerName: string;
  providerNpi: string;
  providerSchedulingNotes: string;
  providerSpecialty: string;
  websiteUrl: string;
};

export type PracticeWorkspaceSnapshot = {
  branding: PracticeBranding;
  draft: PracticeWorkspaceDraft;
  insuranceCrosswalkComplete: boolean;
  knowledgeBaseComplete: boolean;
  launched: boolean;
  practiceProfileComplete: boolean;
  providerRoutingComplete: boolean;
  rulesAndEscalationsComplete: boolean;
};

type PracticeWorkspaceUser = {
  email: string;
  id: string;
  name?: string | null;
};

const practiceWorkspaceInclude = {
  insuranceCrosswalk: true,
  knowledgeBase: true,
  locations: {
    orderBy: {
      createdAt: "asc",
    },
  },
  providers: {
    include: {
      primaryLocation: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  },
  websiteScans: {
    orderBy: {
      scannedAt: "desc",
    },
    take: 1,
  },
} as const;

type LoadedPractice = Prisma.PracticeGetPayload<{
  include: typeof practiceWorkspaceInclude;
}>;

let workspaceTablesAvailable: boolean | null = null;

function textValue(value: string | null | undefined) {
  return (value || "").trim();
}

function hasText(value: string | null | undefined) {
  return Boolean(textValue(value));
}

function inferPracticeNameFromUser(user: PracticeWorkspaceUser) {
  if (user.name?.trim()) {
    return user.name.trim();
  }

  const domain = user.email.split("@")[1]?.split(".")[0];

  if (!domain) {
    return "New Practice";
  }

  return domain
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getPrimaryLocation(practice: LoadedPractice) {
  return (
    practice.locations.find((location) => location.isPrimary) ||
    practice.locations[0] ||
    null
  );
}

function readLocationOverrides(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const rawOverrides = (value as Record<string, unknown>).locationOverrides;

  if (!Array.isArray(rawOverrides)) {
    return [];
  }

  return rawOverrides
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
    )
    .map((entry) => ({
      insuranceNotes: textValue(entry.insuranceNotes as string | undefined),
      insuranceVaries: entry.insuranceVaries === true,
      knowledgeNotes: textValue(entry.knowledgeNotes as string | undefined),
      knowledgeVaries: entry.knowledgeVaries === true,
      locationId: textValue(entry.locationId as string | undefined),
      locationName: textValue(entry.locationName as string | undefined),
    }));
}

function getLocationOverride(
  overrides: ReturnType<typeof readLocationOverrides>,
  location: LoadedPractice["locations"][number],
) {
  return overrides.find(
    (override) =>
      (override.locationId && override.locationId === location.id) ||
      (override.locationName && override.locationName === location.name),
  );
}

function buildDraftFromPractice(practice: LoadedPractice): PracticeWorkspaceDraft {
  const primaryLocation = getPrimaryLocation(practice);
  const insuranceLocationOverrides = readLocationOverrides(
    practice.insuranceCrosswalk?.planRules,
  );
  const knowledgeLocationOverrides = readLocationOverrides(
    practice.knowledgeBase?.operationalNotes,
  );
  const locations = practice.locations.map<PracticeLocationDraft>((location) => {
    const insuranceOverride = getLocationOverride(insuranceLocationOverrides, location);
    const knowledgeOverride = getLocationOverride(knowledgeLocationOverrides, location);

    return {
      address: textValue(location.address),
      fax: textValue(location.fax),
      hours: textValue(location.hoursSummary),
      id: location.id,
      insuranceNotes: insuranceOverride?.insuranceNotes || "",
      insuranceVaries: insuranceOverride?.insuranceVaries === true,
      knowledgeNotes: knowledgeOverride?.knowledgeNotes || "",
      knowledgeVaries: knowledgeOverride?.knowledgeVaries === true,
      locationName: textValue(location.name),
      phone: textValue(location.phone),
    };
  });
  const providers = practice.providers.map<PracticeProviderDraft>((provider) => ({
    id: provider.id,
    providerHours: textValue(provider.scheduleSummary),
    providerLocation: textValue(provider.primaryLocation?.name || primaryLocation?.name),
    providerName: textValue(provider.displayName),
    providerNpi: textValue(provider.npi),
    providerSchedulingNotes: textValue(provider.schedulingNotes),
    providerSpecialty: textValue(provider.specialtySummary),
  }));
  const primaryProvider = providers[0] || null;
  const knowledgeBase = practice.knowledgeBase;
  const insuranceCrosswalk = practice.insuranceCrosswalk;

  return {
    address: textValue(primaryLocation?.address),
    fax: textValue(primaryLocation?.fax),
    insuranceAcceptedPlans: textValue(insuranceCrosswalk?.acceptedPlans),
    insuranceExceptions: textValue(insuranceCrosswalk?.exceptions),
    insuranceTransferRules: textValue(insuranceCrosswalk?.transferRules),
    knowledgeAfterHours: textValue(knowledgeBase?.afterHoursRules),
    knowledgeAppointmentPrep: textValue(knowledgeBase?.appointmentPrep),
    knowledgeCommonQuestions: textValue(knowledgeBase?.commonQuestions),
    knowledgeOfficePolicies: textValue(knowledgeBase?.officePolicies),
    knowledgePhrases: textValue(knowledgeBase?.phrasingRules),
    locations,
    locationName: textValue(primaryLocation?.name),
    phone: textValue(primaryLocation?.phone),
    practiceName: textValue(practice.name),
    providers,
    providerHours: textValue(primaryProvider?.providerHours),
    providerLocation: textValue(primaryProvider?.providerLocation),
    providerName: textValue(primaryProvider?.providerName),
    providerNpi: textValue(primaryProvider?.providerNpi),
    providerSchedulingNotes: textValue(primaryProvider?.providerSchedulingNotes),
    providerSpecialty: textValue(primaryProvider?.providerSpecialty),
    websiteUrl: textValue(practice.websiteUrl || practice.websiteScans[0]?.sourceUrl),
  };
}

function buildSnapshotFromPractice(practice: LoadedPractice): PracticeWorkspaceSnapshot {
  const draft = buildDraftFromPractice(practice);
  const knowledgeBase = practice.knowledgeBase;
  const insuranceCrosswalk = practice.insuranceCrosswalk;
  const launched = Boolean(practice.launchedAt) || practice.onboardingStatus === "LIVE";
  const practiceProfileComplete =
    hasText(draft.practiceName) &&
    draft.locations.some(
      (location) =>
        hasText(location.locationName) &&
        hasText(location.address) &&
        hasText(location.phone),
    );
  const providerRoutingComplete =
    draft.providers.some((provider) => hasText(provider.providerName)) ||
    hasText(draft.providerName);
  const insuranceCrosswalkComplete =
    hasText(insuranceCrosswalk?.acceptedPlans) ||
    hasText(insuranceCrosswalk?.exceptions) ||
    draft.locations.some(
      (location) => location.insuranceVaries || hasText(location.insuranceNotes),
    );
  const knowledgeBaseComplete =
    hasText(knowledgeBase?.commonQuestions) ||
    hasText(knowledgeBase?.appointmentPrep) ||
    hasText(knowledgeBase?.officePolicies) ||
    hasText(knowledgeBase?.afterHoursRules) ||
    hasText(knowledgeBase?.phrasingRules) ||
    hasText(knowledgeBase?.scopeSummary) ||
    hasText(insuranceCrosswalk?.transferRules) ||
    draft.locations.some(
      (location) => location.knowledgeVaries || hasText(location.knowledgeNotes),
    );

  return {
    branding: getPracticeBranding(practice),
    draft,
    insuranceCrosswalkComplete,
    knowledgeBaseComplete,
    launched,
    practiceProfileComplete,
    providerRoutingComplete,
    rulesAndEscalationsComplete: true,
  };
}

function resolveOnboardingStatus(snapshot: PracticeWorkspaceSnapshot) {
  if (snapshot.launched) {
    return "LIVE";
  }

  if (!snapshot.practiceProfileComplete) {
    return "BASICS_PENDING";
  }

  if (!snapshot.providerRoutingComplete) {
    return "PROVIDERS_PENDING";
  }

  if (!snapshot.insuranceCrosswalkComplete) {
    return "INSURANCE_PENDING";
  }

  if (!snapshot.knowledgeBaseComplete) {
    return "KNOWLEDGE_PENDING";
  }

  return "READY_TO_LAUNCH";
}

export async function hasPracticeWorkspaceTables() {
  if (workspaceTablesAvailable !== null) {
    return workspaceTablesAvailable;
  }

  try {
    const [row] = await prisma.$queryRawUnsafe<Array<Record<string, string | null>>>(
      `SELECT
        to_regclass('public.practice')::text AS practice,
        to_regclass('public.practice_membership')::text AS practice_membership,
        to_regclass('public.practice_location')::text AS practice_location,
        to_regclass('public.practice_provider')::text AS practice_provider,
        to_regclass('public.practice_knowledge_base')::text AS practice_knowledge_base,
        to_regclass('public.practice_insurance_crosswalk')::text AS practice_insurance_crosswalk,
        to_regclass('public.practice_website_scan')::text AS practice_website_scan`,
    );

    workspaceTablesAvailable = Object.values(row || {}).every(Boolean);
    return workspaceTablesAvailable;
  } catch {
    return false;
  }
}

async function ensurePracticeForUser(user: PracticeWorkspaceUser) {
  const membership = await prisma.practiceMembership.findFirst({
    include: {
      practice: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    where: {
      userId: user.id,
    },
  });

  if (membership?.practice) {
    return membership.practice;
  }

  return prisma.practice.create({
    data: {
      memberships: {
        create: {
          role: "OWNER",
          userId: user.id,
        },
      },
      name: inferPracticeNameFromUser(user),
    },
  });
}

async function loadPracticeWorkspace(practiceId: string) {
  return prisma.practice.findUnique({
    include: practiceWorkspaceInclude,
    where: {
      id: practiceId,
    },
  });
}

async function loadOrCreatePracticeWorkspace(user: PracticeWorkspaceUser) {
  const practice = await ensurePracticeForUser(user);

  return loadPracticeWorkspace(practice.id);
}

async function syncPracticeOnboardingStatus(practiceId: string) {
  const practice = await loadPracticeWorkspace(practiceId);

  if (!practice) {
    return;
  }

  const snapshot = buildSnapshotFromPractice(practice);
  const onboardingStatus = resolveOnboardingStatus(snapshot);

  await prisma.practice.update({
    data: {
      launchReadyAt:
        onboardingStatus === "READY_TO_LAUNCH"
          ? practice.launchReadyAt || new Date()
          : null,
      onboardingStatus,
    },
    where: {
      id: practiceId,
    },
  });
}

async function upsertPrimaryLocation(
  practiceId: string,
  values: Partial<{
    address: string;
    email: string;
    fax: string;
    hoursSummary: string;
    name: string;
    phone: string;
  }>,
) {
  if (!Object.values(values).some(Boolean)) {
    return null;
  }

  const existing = await prisma.practiceLocation.findFirst({
    orderBy: {
      createdAt: "asc",
    },
    where: {
      isPrimary: true,
      practiceId,
    },
  });

  if (existing) {
    return prisma.practiceLocation.update({
      data: {
        address: values.address ?? existing.address,
        email: values.email ?? existing.email,
        fax: values.fax ?? existing.fax,
        hoursSummary: values.hoursSummary ?? existing.hoursSummary,
        name: values.name || existing.name,
        phone: values.phone ?? existing.phone,
      },
      where: {
        id: existing.id,
      },
    });
  }

  return prisma.practiceLocation.create({
    data: {
      address: values.address,
      email: values.email,
      fax: values.fax,
      hoursSummary: values.hoursSummary,
      isPrimary: true,
      name: values.name || "Main office",
      phone: values.phone,
      practiceId,
    },
  });
}

function buildInsuranceLocationOverrides(locations: PracticeLocationDraft[]) {
  return locations
    .filter(
      (location) =>
        hasText(location.locationName) &&
        (location.insuranceVaries || hasText(location.insuranceNotes)),
    )
    .map((location) => ({
      insuranceNotes: location.insuranceNotes,
      insuranceVaries: location.insuranceVaries,
      locationId: location.id,
      locationName: location.locationName,
    }));
}

function buildKnowledgeLocationOverrides(locations: PracticeLocationDraft[]) {
  return locations
    .filter(
      (location) =>
        hasText(location.locationName) &&
        (location.knowledgeVaries || hasText(location.knowledgeNotes)),
    )
    .map((location) => ({
      knowledgeNotes: location.knowledgeNotes,
      knowledgeVaries: location.knowledgeVaries,
      locationId: location.id,
      locationName: location.locationName,
    }));
}

async function persistLocationOverrides(
  practiceId: string,
  locations: PracticeLocationDraft[],
) {
  const insuranceOverrides = buildInsuranceLocationOverrides(locations);
  const knowledgeOverrides = buildKnowledgeLocationOverrides(locations);

  await prisma.practiceInsuranceCrosswalk.upsert({
    create: {
      planRules: {
        locationOverrides: insuranceOverrides,
      },
      practiceId,
    },
    update: {
      planRules: {
        locationOverrides: insuranceOverrides,
      },
    },
    where: {
      practiceId,
    },
  });

  await prisma.practiceKnowledgeBase.upsert({
    create: {
      operationalNotes: {
        locationOverrides: knowledgeOverrides,
      },
      practiceId,
    },
    update: {
      operationalNotes: {
        locationOverrides: knowledgeOverrides,
      },
    },
    where: {
      practiceId,
    },
  });
}

async function upsertPracticeLocations(
  practiceId: string,
  locations: PracticeLocationDraft[],
) {
  const submittedLocations = locations.filter((location) =>
    hasText(location.locationName),
  );

  if (!submittedLocations.length) {
    return [];
  }

  const existingLocations = await prisma.practiceLocation.findMany({
    orderBy: {
      createdAt: "asc",
    },
    where: {
      practiceId,
    },
  });
  const savedLocations: PracticeLocationDraft[] = [];

  for (const [index, location] of submittedLocations.entries()) {
    const existingLocation =
      (location.id &&
        existingLocations.find((candidate) => candidate.id === location.id)) ||
      existingLocations[index];
    const locationData = {
      address: location.address || null,
      fax: location.fax || null,
      hoursSummary: location.hours || null,
      isPrimary: index === 0,
      name: location.locationName,
      phone: location.phone || null,
    };
    const savedLocation = existingLocation
      ? await prisma.practiceLocation.update({
          data: locationData,
          where: {
            id: existingLocation.id,
          },
        })
      : await prisma.practiceLocation.create({
          data: {
            ...locationData,
            practiceId,
          },
        });

    savedLocations.push({
      ...location,
      id: savedLocation.id,
    });
  }

  const savedLocationIds = new Set(savedLocations.map((location) => location.id));
  const removedLocationIds = existingLocations
    .filter((location) => !savedLocationIds.has(location.id))
    .map((location) => location.id);

  await syncPracticePhoneNumbers(practiceId, savedLocations, removedLocationIds);

  if (removedLocationIds.length) {
    await prisma.practiceLocation.deleteMany({
      where: {
        id: {
          in: removedLocationIds,
        },
        practiceId,
      },
    });
  }

  return savedLocations;
}

async function syncPracticePhoneNumbers(
  practiceId: string,
  locations: PracticeLocationDraft[],
  removedLocationIds: string[],
) {
  if (removedLocationIds.length) {
    await prisma.practicePhoneNumber.deleteMany({
      where: {
        locationId: {
          in: removedLocationIds,
        },
        practiceId,
      },
    });
  }

  const existingPhoneNumbers = await prisma.practicePhoneNumber.findMany({
    where: {
      practiceId,
    },
  });

  for (const [index, location] of locations.entries()) {
    if (!location.id) {
      continue;
    }

    const phoneNumber = textValue(location.phone);

    if (!phoneNumber) {
      await prisma.practicePhoneNumber.deleteMany({
        where: {
          locationId: location.id,
          practiceId,
        },
      });
      continue;
    }

    const data = {
      isPrimary: index === 0,
      label: textValue(location.locationName) || null,
      locationId: location.id,
    };
    const existingForPhone = existingPhoneNumbers.find(
      (phone) => phone.phoneNumber === phoneNumber,
    );
    const existingForLocation = existingPhoneNumbers.find(
      (phone) => phone.locationId === location.id,
    );

    if (existingForPhone) {
      await prisma.practicePhoneNumber.update({
        data,
        where: {
          id: existingForPhone.id,
        },
      });
      continue;
    }

    if (existingForLocation) {
      await prisma.practicePhoneNumber.update({
        data: {
          ...data,
          phoneNumber,
        },
        where: {
          id: existingForLocation.id,
        },
      });
      continue;
    }

    await prisma.practicePhoneNumber.create({
      data: {
        ...data,
        phoneNumber,
        practiceId,
      },
    });
  }
}

async function upsertPrimaryProvider(
  practiceId: string,
  values: Partial<{
    displayName: string;
    npi: string;
    primaryLocationId: string;
    scheduleSummary: string;
    schedulingNotes: string;
    specialtySummary: string;
    speechAliases: string[];
  }>,
) {
  if (!values.displayName) {
    return null;
  }

  const existing =
    (await prisma.practiceProvider.findFirst({
      where: {
        displayName: values.displayName,
        practiceId,
      },
    })) ||
    (await prisma.practiceProvider.findFirst({
      orderBy: {
        createdAt: "asc",
      },
      where: {
        practiceId,
      },
    }));

  if (existing) {
    return prisma.practiceProvider.update({
      data: {
        displayName: values.displayName || existing.displayName,
        npi: values.npi ?? existing.npi,
        primaryLocationId: values.primaryLocationId ?? existing.primaryLocationId,
        scheduleSummary: values.scheduleSummary ?? existing.scheduleSummary,
        schedulingNotes: values.schedulingNotes ?? existing.schedulingNotes,
        specialtySummary: values.specialtySummary ?? existing.specialtySummary,
        speechAliases: values.speechAliases?.length
          ? values.speechAliases
          : (existing.speechAliases ?? undefined),
      },
      where: {
        id: existing.id,
      },
    });
  }

  return prisma.practiceProvider.create({
    data: {
      displayName: values.displayName,
      npi: values.npi,
      practiceId,
      primaryLocationId: values.primaryLocationId,
      scheduleSummary: values.scheduleSummary,
      schedulingNotes: values.schedulingNotes,
      specialtySummary: values.specialtySummary,
      speechAliases: values.speechAliases || [],
    },
  });
}

async function findOrCreateProviderLocation(practiceId: string, locationName: string) {
  if (!hasText(locationName)) {
    return null;
  }

  const existing = await prisma.practiceLocation.findFirst({
    where: {
      name: locationName,
      practiceId,
    },
  });

  if (existing) {
    return existing;
  }

  const existingLocation = await prisma.practiceLocation.findFirst({
    where: {
      practiceId,
    },
  });

  return prisma.practiceLocation.create({
    data: {
      isPrimary: !existingLocation,
      name: locationName,
      practiceId,
    },
  });
}

export async function getPracticeWorkspaceSnapshotForUser(user: PracticeWorkspaceUser) {
  if (!(await hasPracticeWorkspaceTables())) {
    return null;
  }

  const practice = await loadOrCreatePracticeWorkspace(user);

  if (!practice) {
    return null;
  }

  return buildSnapshotFromPractice(practice);
}

export async function persistWebsiteScanForUser(
  user: PracticeWorkspaceUser,
  scanResult: PracticeWebsiteScanResult,
) {
  if (!(await hasPracticeWorkspaceTables())) {
    return;
  }

  const practice = await ensurePracticeForUser(user);

  await prisma.practice.update({
    data: {
      name: scanResult.practiceName || practice.name,
      practiceType: scanResult.practiceType,
      websiteUrl: scanResult.finalUrl || scanResult.sourceUrl,
    },
    where: {
      id: practice.id,
    },
  });

  const primaryLocation = await upsertPrimaryLocation(practice.id, {
    address: scanResult.primaryLocation?.address,
    email: scanResult.primaryLocation?.email,
    fax: scanResult.primaryLocation?.fax,
    hoursSummary: scanResult.primaryLocation?.hoursSummary,
    name: scanResult.primaryLocation?.name || scanResult.practiceName,
    phone: scanResult.primaryLocation?.phone,
  });

  if (scanResult.providers[0]) {
    await upsertPrimaryProvider(practice.id, {
      displayName: scanResult.providers[0].displayName,
      npi: scanResult.providers[0].npi,
      primaryLocationId: primaryLocation?.id,
      specialtySummary: scanResult.providers[0].specialtySummary,
      speechAliases: scanResult.providers[0].speechAliases,
    });
  }

  await prisma.practiceWebsiteScan.create({
    data: {
      errorMessage: scanResult.errorMessage,
      extractedData: scanResult as Prisma.InputJsonValue,
      finalUrl: scanResult.finalUrl,
      metaDescription: scanResult.metaDescription,
      practiceId: practice.id,
      scanStatus: scanResult.status,
      sourceUrl: scanResult.sourceUrl,
      title: scanResult.title,
    },
  });

  if (
    scanResult.knowledgeHints.emergencyNotice ||
    scanResult.knowledgeHints.scopeSummary ||
    scanResult.knowledgeHints.excludedServices.length ||
    scanResult.knowledgeHints.whatToBring.length ||
    scanResult.knowledgeHints.appointmentExpectations.length
  ) {
    await prisma.practiceKnowledgeBase.upsert({
      create: {
        appointmentExpectations: scanResult.knowledgeHints.appointmentExpectations,
        emergencyNotice: scanResult.knowledgeHints.emergencyNotice,
        excludedServices: scanResult.knowledgeHints.excludedServices,
        practiceId: practice.id,
        scopeSummary: scanResult.knowledgeHints.scopeSummary,
        whatToBring: scanResult.knowledgeHints.whatToBring,
      },
      update: {
        appointmentExpectations: scanResult.knowledgeHints.appointmentExpectations.length
          ? scanResult.knowledgeHints.appointmentExpectations
          : undefined,
        emergencyNotice: scanResult.knowledgeHints.emergencyNotice,
        excludedServices: scanResult.knowledgeHints.excludedServices.length
          ? scanResult.knowledgeHints.excludedServices
          : undefined,
        scopeSummary: scanResult.knowledgeHints.scopeSummary,
        whatToBring: scanResult.knowledgeHints.whatToBring.length
          ? scanResult.knowledgeHints.whatToBring
          : undefined,
      },
      where: {
        practiceId: practice.id,
      },
    });
  }

  await syncPracticeOnboardingStatus(practice.id);
}

export async function persistPracticeBasicsForUser(
  user: PracticeWorkspaceUser,
  input: {
    address: string;
    fax: string;
    locationName: string;
    locations: PracticeLocationDraft[];
    phone: string;
    practiceName: string;
  },
) {
  if (!(await hasPracticeWorkspaceTables())) {
    return;
  }

  const practice = await ensurePracticeForUser(user);

  await prisma.practice.update({
    data: {
      name: input.practiceName || practice.name,
    },
    where: {
      id: practice.id,
    },
  });

  const savedLocations = await upsertPracticeLocations(
    practice.id,
    input.locations.length
      ? input.locations
      : [
          {
            address: input.address,
            fax: input.fax,
            hours: "",
            insuranceNotes: "",
            insuranceVaries: false,
            knowledgeNotes: "",
            knowledgeVaries: false,
            locationName: input.locationName,
            phone: input.phone,
          },
        ],
  );

  await persistLocationOverrides(practice.id, savedLocations);

  await syncPracticeOnboardingStatus(practice.id);
}

export async function persistProviderSetupForUser(
  user: PracticeWorkspaceUser,
  input: {
    providers: PracticeProviderDraft[];
  },
) {
  if (!(await hasPracticeWorkspaceTables())) {
    return;
  }

  const practice = await ensurePracticeForUser(user);
  const submittedProviders = input.providers.filter((provider) =>
    hasText(provider.providerName),
  );

  if (!submittedProviders.length) {
    await prisma.practiceProvider.deleteMany({
      where: {
        practiceId: practice.id,
      },
    });
    await syncPracticeOnboardingStatus(practice.id);
    return;
  }

  const existingProviders = await prisma.practiceProvider.findMany({
    orderBy: {
      createdAt: "asc",
    },
    where: {
      practiceId: practice.id,
    },
  });
  const savedProviderIds = new Set<string>();

  for (const [index, provider] of submittedProviders.entries()) {
    const location = await findOrCreateProviderLocation(
      practice.id,
      provider.providerLocation,
    );
    const existingProvider =
      (provider.id &&
        existingProviders.find((candidate) => candidate.id === provider.id)) ||
      existingProviders[index];
    const providerData = {
      displayName: provider.providerName,
      npi: provider.providerNpi || null,
      primaryLocationId: location?.id || null,
      scheduleSummary: provider.providerHours || null,
      schedulingNotes: provider.providerSchedulingNotes || null,
      specialtySummary: provider.providerSpecialty || null,
    };
    const savedProvider = existingProvider
      ? await prisma.practiceProvider.update({
          data: providerData,
          where: {
            id: existingProvider.id,
          },
        })
      : await prisma.practiceProvider.create({
          data: {
            ...providerData,
            practiceId: practice.id,
            speechAliases: [],
          },
        });

    savedProviderIds.add(savedProvider.id);
  }

  const removedProviderIds = existingProviders
    .filter((provider) => !savedProviderIds.has(provider.id))
    .map((provider) => provider.id);

  if (removedProviderIds.length) {
    await prisma.practiceProvider.deleteMany({
      where: {
        id: {
          in: removedProviderIds,
        },
        practiceId: practice.id,
      },
    });
  }

  await syncPracticeOnboardingStatus(practice.id);
}

export async function persistKnowledgeBaseForUser(
  user: PracticeWorkspaceUser,
  input: {
    knowledgeAfterHours: string;
    knowledgeAppointmentPrep: string;
    knowledgeCommonQuestions: string;
    knowledgeLocationRules?: PracticeLocationDraft[];
    knowledgeOfficePolicies: string;
    knowledgePhrases: string;
  },
) {
  if (!(await hasPracticeWorkspaceTables())) {
    return;
  }

  const practice = await ensurePracticeForUser(user);

  await prisma.practiceKnowledgeBase.upsert({
    create: {
      afterHoursRules: input.knowledgeAfterHours,
      appointmentPrep: input.knowledgeAppointmentPrep,
      commonQuestions: input.knowledgeCommonQuestions,
      officePolicies: input.knowledgeOfficePolicies,
      operationalNotes: input.knowledgeLocationRules
        ? {
            locationOverrides: buildKnowledgeLocationOverrides(
              input.knowledgeLocationRules,
            ),
          }
        : undefined,
      phrasingRules: input.knowledgePhrases,
      practiceId: practice.id,
    },
    update: {
      afterHoursRules: input.knowledgeAfterHours,
      appointmentPrep: input.knowledgeAppointmentPrep,
      commonQuestions: input.knowledgeCommonQuestions,
      officePolicies: input.knowledgeOfficePolicies,
      operationalNotes: input.knowledgeLocationRules
        ? {
            locationOverrides: buildKnowledgeLocationOverrides(
              input.knowledgeLocationRules,
            ),
          }
        : undefined,
      phrasingRules: input.knowledgePhrases,
    },
    where: {
      practiceId: practice.id,
    },
  });

  await syncPracticeOnboardingStatus(practice.id);
}

export async function persistInsuranceCrosswalkForUser(
  user: PracticeWorkspaceUser,
  input: {
    insuranceAcceptedPlans: string;
    insuranceExceptions: string;
    insuranceLocationRules?: PracticeLocationDraft[];
    insuranceTransferRules: string;
  },
) {
  if (!(await hasPracticeWorkspaceTables())) {
    return;
  }

  const practice = await ensurePracticeForUser(user);

  await prisma.practiceInsuranceCrosswalk.upsert({
    create: {
      acceptedPlans: input.insuranceAcceptedPlans,
      exceptions: input.insuranceExceptions,
      planRules: input.insuranceLocationRules
        ? {
            locationOverrides: buildInsuranceLocationOverrides(
              input.insuranceLocationRules,
            ),
          }
        : undefined,
      practiceId: practice.id,
      transferRules: input.insuranceTransferRules,
    },
    update: {
      acceptedPlans: input.insuranceAcceptedPlans,
      exceptions: input.insuranceExceptions,
      planRules: input.insuranceLocationRules
        ? {
            locationOverrides: buildInsuranceLocationOverrides(
              input.insuranceLocationRules,
            ),
          }
        : undefined,
      transferRules: input.insuranceTransferRules,
    },
    where: {
      practiceId: practice.id,
    },
  });

  await syncPracticeOnboardingStatus(practice.id);
}

export async function persistLaunchStateForUser(user: PracticeWorkspaceUser) {
  if (!(await hasPracticeWorkspaceTables())) {
    return;
  }

  const practice = await ensurePracticeForUser(user);

  await prisma.practice.update({
    data: {
      launchedAt: new Date(),
      onboardingStatus: "LIVE",
    },
    where: {
      id: practice.id,
    },
  });
}
