import type { Prisma } from "@/generated/prisma/client";

import type { PracticeWebsiteScanResult } from "./practice-records";
import { prisma } from "./prisma";

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
  locationName: string;
  phone: string;
  practiceName: string;
  providerHours: string;
  providerLocation: string;
  providerName: string;
  providerNpi: string;
  providerSchedulingNotes: string;
  providerSpecialty: string;
  websiteUrl: string;
};

export type PracticeWorkspaceSnapshot = {
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
  locations: true,
  providers: {
    include: {
      primaryLocation: true,
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
    practice.locations.find((location) => location.isPrimary) || practice.locations[0] || null
  );
}

function getPrimaryProvider(practice: LoadedPractice) {
  return practice.providers[0] || null;
}

function buildDraftFromPractice(practice: LoadedPractice): PracticeWorkspaceDraft {
  const primaryLocation = getPrimaryLocation(practice);
  const primaryProvider = getPrimaryProvider(practice);
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
    locationName: textValue(primaryLocation?.name),
    phone: textValue(primaryLocation?.phone),
    practiceName: textValue(practice.name),
    providerHours: textValue(primaryProvider?.scheduleSummary),
    providerLocation: textValue(primaryProvider?.primaryLocation?.name || primaryLocation?.name),
    providerName: textValue(primaryProvider?.displayName),
    providerNpi: textValue(primaryProvider?.npi),
    providerSchedulingNotes: textValue(primaryProvider?.schedulingNotes),
    providerSpecialty: textValue(primaryProvider?.specialtySummary),
    websiteUrl: textValue(practice.websiteUrl || practice.websiteScans[0]?.sourceUrl),
  };
}

function buildSnapshotFromPractice(practice: LoadedPractice): PracticeWorkspaceSnapshot {
  const draft = buildDraftFromPractice(practice);
  const knowledgeBase = practice.knowledgeBase;
  const insuranceCrosswalk = practice.insuranceCrosswalk;
  const launched = Boolean(practice.launchedAt);
  const practiceProfileComplete =
    hasText(draft.websiteUrl) &&
    hasText(draft.practiceName) &&
    hasText(draft.locationName) &&
    hasText(draft.address) &&
    hasText(draft.phone);
  const providerRoutingComplete = hasText(draft.providerName);
  const insuranceCrosswalkComplete =
    hasText(insuranceCrosswalk?.acceptedPlans) ||
    hasText(insuranceCrosswalk?.exceptions) ||
    hasText(insuranceCrosswalk?.transferRules);
  const knowledgeBaseComplete =
    hasText(knowledgeBase?.commonQuestions) ||
    hasText(knowledgeBase?.appointmentPrep) ||
    hasText(knowledgeBase?.officePolicies) ||
    hasText(knowledgeBase?.afterHoursRules) ||
    hasText(knowledgeBase?.phrasingRules) ||
    hasText(knowledgeBase?.scopeSummary);

  return {
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

  if (!hasText(snapshot.draft.websiteUrl)) {
    return "WEBSITE_PENDING";
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
    const [row] = await prisma.$queryRawUnsafe<
      Array<Record<string, string | null>>
    >(
      `SELECT
        to_regclass('public.practice') AS practice,
        to_regclass('public.practice_membership') AS practice_membership,
        to_regclass('public.practice_location') AS practice_location,
        to_regclass('public.practice_provider') AS practice_provider,
        to_regclass('public.practice_knowledge_base') AS practice_knowledge_base,
        to_regclass('public.practice_insurance_crosswalk') AS practice_insurance_crosswalk,
        to_regclass('public.practice_website_scan') AS practice_website_scan`
    );

    workspaceTablesAvailable = Object.values(row || {}).every(Boolean);
    return workspaceTablesAvailable;
  } catch {
    workspaceTablesAvailable = false;
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
        onboardingStatus === "READY_TO_LAUNCH" ? practice.launchReadyAt || new Date() : null,
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
  }>
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
  }>
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
          : existing.speechAliases ?? undefined,
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
  scanResult: PracticeWebsiteScanResult
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
    phone: string;
    practiceName: string;
  }
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

  await upsertPrimaryLocation(practice.id, {
    address: input.address,
    fax: input.fax,
    name: input.locationName,
    phone: input.phone,
  });

  await syncPracticeOnboardingStatus(practice.id);
}

export async function persistProviderSetupForUser(
  user: PracticeWorkspaceUser,
  input: {
    providerHours: string;
    providerLocation: string;
    providerName: string;
    providerNpi: string;
    providerSchedulingNotes: string;
    providerSpecialty: string;
  }
) {
  if (!(await hasPracticeWorkspaceTables())) {
    return;
  }

  const practice = await ensurePracticeForUser(user);
  const primaryLocation = await upsertPrimaryLocation(practice.id, {
    name: input.providerLocation,
  });

  await upsertPrimaryProvider(practice.id, {
    displayName: input.providerName,
    npi: input.providerNpi,
    primaryLocationId: primaryLocation?.id,
    scheduleSummary: input.providerHours,
    schedulingNotes: input.providerSchedulingNotes,
    specialtySummary: input.providerSpecialty,
  });

  await syncPracticeOnboardingStatus(practice.id);
}

export async function persistKnowledgeBaseForUser(
  user: PracticeWorkspaceUser,
  input: {
    knowledgeAfterHours: string;
    knowledgeAppointmentPrep: string;
    knowledgeCommonQuestions: string;
    knowledgeOfficePolicies: string;
    knowledgePhrases: string;
  }
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
      phrasingRules: input.knowledgePhrases,
      practiceId: practice.id,
    },
    update: {
      afterHoursRules: input.knowledgeAfterHours,
      appointmentPrep: input.knowledgeAppointmentPrep,
      commonQuestions: input.knowledgeCommonQuestions,
      officePolicies: input.knowledgeOfficePolicies,
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
    insuranceTransferRules: string;
  }
) {
  if (!(await hasPracticeWorkspaceTables())) {
    return;
  }

  const practice = await ensurePracticeForUser(user);

  await prisma.practiceInsuranceCrosswalk.upsert({
    create: {
      acceptedPlans: input.insuranceAcceptedPlans,
      exceptions: input.insuranceExceptions,
      practiceId: practice.id,
      transferRules: input.insuranceTransferRules,
    },
    update: {
      acceptedPlans: input.insuranceAcceptedPlans,
      exceptions: input.insuranceExceptions,
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
