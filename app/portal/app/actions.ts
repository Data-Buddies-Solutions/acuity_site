"use server";

import { redirect } from "next/navigation";

import { getAuthSession } from "@/lib/auth";
import {
  persistInsuranceCrosswalkForUser,
  persistKnowledgeBaseForUser,
  persistLaunchStateForUser,
  persistPracticeBasicsForUser,
  persistProviderSetupForUser,
  persistWebsiteScanForUser,
  type PracticeLocationDraft,
  type PracticeProviderDraft,
} from "@/lib/practice-workspace";
import { getCurrentPortalPracticeContext } from "@/lib/portal-access";
import {
  getPortalWorkspaceState,
  setPortalLaunchState,
  setPortalSectionCompletion,
  updatePortalDraftState,
} from "@/lib/portal-state";
import { scanPracticeWebsite } from "@/lib/website-scan";

function readTextField(formData: FormData, key: string, maxLength?: number) {
  const value = String(formData.get(key) || "").trim();

  return typeof maxLength === "number" ? value.slice(0, maxLength) : value;
}

function readRepeatedTextFields(formData: FormData, key: string, maxLength?: number) {
  return formData.getAll(key).map((value) => {
    const normalizedValue = String(value || "").trim();

    return typeof maxLength === "number"
      ? normalizedValue.slice(0, maxLength)
      : normalizedValue;
  });
}

function readProviderRows(formData: FormData): PracticeProviderDraft[] {
  const ids = readRepeatedTextFields(formData, "providerId", 80);
  const names = readRepeatedTextFields(formData, "providerName", 160);
  const specialties = readRepeatedTextFields(formData, "providerSpecialty", 240);
  const npis = readRepeatedTextFields(formData, "providerNpi", 30);
  const locations = readRepeatedTextFields(formData, "providerLocation", 160);
  const hours = readRepeatedTextFields(formData, "providerHours", 1000);
  const rowCount = Math.max(
    ids.length,
    names.length,
    specialties.length,
    npis.length,
    locations.length,
    hours.length,
  );

  return Array.from({ length: rowCount }, (_, index) => ({
    id: ids[index] || undefined,
    providerHours: hours[index] || "",
    providerLocation: locations[index] || "",
    providerName: names[index] || "",
    providerNpi: npis[index] || "",
    providerSchedulingNotes: "",
    providerSpecialty: specialties[index] || "",
  })).filter((provider) =>
    [
      provider.providerHours,
      provider.providerLocation,
      provider.providerName,
      provider.providerNpi,
      provider.providerSchedulingNotes,
      provider.providerSpecialty,
    ].some(Boolean),
  );
}

function readLocationRows(formData: FormData): PracticeLocationDraft[] {
  const ids = readRepeatedTextFields(formData, "locationId", 80);
  const names = readRepeatedTextFields(formData, "locationName", 160);
  const addresses = readRepeatedTextFields(formData, "address", 1000);
  const phones = readRepeatedTextFields(formData, "phone", 80);
  const faxes = readRepeatedTextFields(formData, "fax", 80);
  const hours = readRepeatedTextFields(formData, "hours", 1000);
  const insuranceVaries = readRepeatedTextFields(formData, "insuranceVaries", 10);
  const insuranceNotes = readRepeatedTextFields(formData, "insuranceNotes");
  const knowledgeVaries = readRepeatedTextFields(formData, "knowledgeVaries", 10);
  const knowledgeNotes = readRepeatedTextFields(formData, "knowledgeNotes");
  const rowCount = Math.max(
    ids.length,
    names.length,
    addresses.length,
    phones.length,
    faxes.length,
    hours.length,
    insuranceVaries.length,
    insuranceNotes.length,
    knowledgeVaries.length,
    knowledgeNotes.length,
  );

  return Array.from({ length: rowCount }, (_, index) => ({
    address: addresses[index] || "",
    fax: faxes[index] || "",
    hours: hours[index] || "",
    id: ids[index] || undefined,
    insuranceNotes: insuranceNotes[index] || "",
    insuranceVaries: insuranceVaries[index] === "true",
    knowledgeNotes: knowledgeNotes[index] || "",
    knowledgeVaries: knowledgeVaries[index] === "true",
    locationName: names[index] || "",
    phone: phones[index] || "",
  })).filter((location) =>
    [
      location.address,
      location.fax,
      location.hours,
      location.insuranceNotes,
      location.knowledgeNotes,
      location.locationName,
      location.phone,
    ].some(Boolean),
  );
}

function mergeLocationRuleRows(
  currentLocations: PracticeLocationDraft[],
  formData: FormData,
  {
    notesKey,
    variesKey,
  }: {
    notesKey: "insuranceNotes" | "knowledgeNotes";
    variesKey: "insuranceVaries" | "knowledgeVaries";
  },
) {
  const ids = readRepeatedTextFields(formData, "locationId", 80);
  const names = readRepeatedTextFields(formData, "locationName", 160);
  const varies = readRepeatedTextFields(formData, variesKey, 10);
  const notes = readRepeatedTextFields(formData, notesKey);
  const rulesAreShared =
    formData.get(
      variesKey === "insuranceVaries" ? "insuranceRulesScope" : "knowledgeRulesScope",
    ) !== "byLocation";

  if (rulesAreShared) {
    return currentLocations.map((location) => ({
      ...location,
      [notesKey]: "",
      [variesKey]: false,
    }));
  }

  return currentLocations.map((location) => {
    const rowIndex = ids.findIndex(
      (id, index) =>
        (id && location.id && id === location.id) ||
        (!id && names[index] === location.locationName),
    );

    if (rowIndex === -1) {
      return location;
    }

    return {
      ...location,
      [notesKey]: notes[rowIndex] || "",
      [variesKey]: varies[rowIndex] === "true",
    };
  });
}

function normalizeWebsiteUrl(rawValue: string) {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return "";
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(candidate).toString();
  } catch {
    return "";
  }
}

async function getWorkspaceUser() {
  const session = await getAuthSession();

  if (!session) {
    return null;
  }

  return {
    email: session.user.email,
    id: session.user.id,
    name: session.user.name,
  };
}

async function requirePracticeWidePortalAccess() {
  const context = await getCurrentPortalPracticeContext();

  if (context && !context.hasAllLocationAccess) {
    redirect("/portal/app/overview");
  }
}

export async function scanPracticeWebsiteAction(formData: FormData) {
  await requirePracticeWidePortalAccess();

  const websiteUrl = normalizeWebsiteUrl(readTextField(formData, "websiteUrl", 200));

  if (!websiteUrl) {
    redirect("/portal/app/onboarding?step=practiceProfile");
  }

  const scanResult = await scanPracticeWebsite(websiteUrl);
  const primaryLocation = scanResult.primaryLocation;
  const primaryProvider = scanResult.providers[0];
  const workspaceUser = await getWorkspaceUser();

  await updatePortalDraftState({
    address: primaryLocation?.address || "",
    fax: primaryLocation?.fax || "",
    locations: primaryLocation
      ? [
          {
            address: primaryLocation.address || "",
            fax: primaryLocation.fax || "",
            hours: primaryLocation.hoursSummary || "",
            insuranceNotes: "",
            insuranceVaries: false,
            knowledgeNotes: "",
            knowledgeVaries: false,
            locationName: primaryLocation.name || "",
            phone: primaryLocation.phone || "",
          },
        ]
      : [],
    locationName: primaryLocation?.name || "",
    phone: primaryLocation?.phone || "",
    practiceName: scanResult.practiceName || "",
    providerLocation: primaryLocation?.name || "",
    providerName: primaryProvider?.displayName || "",
    providerNpi: primaryProvider?.npi || "",
    providerSpecialty: primaryProvider?.specialtySummary || "",
    providers: scanResult.providers.map((provider) => ({
      providerHours: "",
      providerLocation: primaryLocation?.name || "",
      providerName: provider.displayName,
      providerNpi: provider.npi || "",
      providerSchedulingNotes: "",
      providerSpecialty: provider.specialtySummary || "",
    })),
    websiteUrl: scanResult.finalUrl || websiteUrl,
  });
  await setPortalSectionCompletion("practiceProfile", false);
  await setPortalSectionCompletion("providerRouting", false);

  if (workspaceUser) {
    await persistWebsiteScanForUser(workspaceUser, scanResult);
  }

  redirect("/portal/app/onboarding?step=practiceProfile");
}

export async function savePracticeBasicsAction(formData: FormData) {
  await requirePracticeWidePortalAccess();

  const locations = readLocationRows(formData);
  const primaryLocation = locations[0];
  const input = {
    address: primaryLocation?.address || "",
    fax: primaryLocation?.fax || "",
    locationName: primaryLocation?.locationName || "",
    locations,
    phone: primaryLocation?.phone || "",
    practiceName: readTextField(formData, "practiceName", 120),
  };
  const workspaceUser = await getWorkspaceUser();

  await updatePortalDraftState(input);
  await setPortalSectionCompletion(
    "practiceProfile",
    Boolean(input.practiceName && input.locationName && input.address && input.phone),
  );

  if (workspaceUser) {
    await persistPracticeBasicsForUser(workspaceUser, input);
  }

  const portalState = await getPortalWorkspaceState();

  redirect(
    portalState.launched
      ? "/portal/app/overview"
      : "/portal/app/onboarding?step=providerRouting",
  );
}

export async function saveProviderSetupAction(formData: FormData) {
  await requirePracticeWidePortalAccess();

  const providers = readProviderRows(formData);
  const primaryProvider = providers[0];
  const input = {
    providerHours: primaryProvider?.providerHours || "",
    providerLocation: primaryProvider?.providerLocation || "",
    providerName: primaryProvider?.providerName || "",
    providerNpi: primaryProvider?.providerNpi || "",
    providerSchedulingNotes: primaryProvider?.providerSchedulingNotes || "",
    providerSpecialty: primaryProvider?.providerSpecialty || "",
    providers,
  };
  const workspaceUser = await getWorkspaceUser();

  await updatePortalDraftState(input);
  await setPortalSectionCompletion(
    "providerRouting",
    providers.some((provider) => provider.providerName),
  );

  if (workspaceUser) {
    await persistProviderSetupForUser(workspaceUser, { providers });
  }

  const portalState = await getPortalWorkspaceState();

  redirect(
    portalState.launched
      ? "/portal/app/overview"
      : providers.some((provider) => provider.providerName)
        ? "/portal/app/onboarding?step=insuranceCrosswalk"
        : "/portal/app/onboarding?step=providerRouting",
  );
}

export async function saveKnowledgeBaseAction(formData: FormData) {
  await requirePracticeWidePortalAccess();

  const currentPortalState = await getPortalWorkspaceState();
  const knowledgeLocationRules = mergeLocationRuleRows(
    currentPortalState.draft.locations,
    formData,
    {
      notesKey: "knowledgeNotes",
      variesKey: "knowledgeVaries",
    },
  );
  const input = {
    insuranceTransferRules: readTextField(formData, "insuranceTransferRules"),
    knowledgeAfterHours: readTextField(formData, "knowledgeAfterHours"),
    knowledgeAppointmentPrep: readTextField(formData, "knowledgeAppointmentPrep"),
    knowledgeCommonQuestions: readTextField(formData, "knowledgeCommonQuestions"),
    knowledgeLocationRules,
    knowledgeOfficePolicies: readTextField(formData, "knowledgeOfficePolicies"),
    knowledgePhrases: readTextField(formData, "knowledgePhrases"),
  };
  const workspaceUser = await getWorkspaceUser();

  await updatePortalDraftState({
    insuranceTransferRules: input.insuranceTransferRules,
    knowledgeAfterHours: input.knowledgeAfterHours,
    knowledgeAppointmentPrep: input.knowledgeAppointmentPrep,
    knowledgeCommonQuestions: input.knowledgeCommonQuestions,
    knowledgeOfficePolicies: input.knowledgeOfficePolicies,
    knowledgePhrases: input.knowledgePhrases,
    locations: knowledgeLocationRules,
  });
  await setPortalSectionCompletion("knowledgeBase", true);

  if (workspaceUser) {
    await persistKnowledgeBaseForUser(workspaceUser, input);
    await persistInsuranceCrosswalkForUser(workspaceUser, {
      insuranceAcceptedPlans: currentPortalState.draft.insuranceAcceptedPlans,
      insuranceExceptions: currentPortalState.draft.insuranceExceptions,
      insuranceLocationRules: knowledgeLocationRules,
      insuranceTransferRules: input.insuranceTransferRules,
    });
  }

  const portalState = await getPortalWorkspaceState();

  redirect(
    portalState.launched
      ? "/portal/app/knowledge-base"
      : "/portal/app/onboarding?step=review",
  );
}

export async function saveInsuranceCrosswalkAction(formData: FormData) {
  await requirePracticeWidePortalAccess();

  const currentPortalState = await getPortalWorkspaceState();
  const insuranceLocationRules = mergeLocationRuleRows(
    currentPortalState.draft.locations,
    formData,
    {
      notesKey: "insuranceNotes",
      variesKey: "insuranceVaries",
    },
  );
  const input = {
    insuranceAcceptedPlans: readTextField(formData, "insuranceAcceptedPlans"),
    insuranceExceptions: readTextField(formData, "insuranceExceptions"),
    insuranceLocationRules,
    insuranceTransferRules: formData.has("insuranceTransferRules")
      ? readTextField(formData, "insuranceTransferRules")
      : currentPortalState.draft.insuranceTransferRules,
  };
  const workspaceUser = await getWorkspaceUser();

  await updatePortalDraftState({
    insuranceAcceptedPlans: input.insuranceAcceptedPlans,
    insuranceExceptions: input.insuranceExceptions,
    insuranceTransferRules: input.insuranceTransferRules,
    locations: insuranceLocationRules,
  });
  await setPortalSectionCompletion("insuranceCrosswalk", true);

  if (workspaceUser) {
    await persistInsuranceCrosswalkForUser(workspaceUser, input);
  }

  const portalState = await getPortalWorkspaceState();

  redirect(
    portalState.launched
      ? "/portal/app/insurance-crosswalk"
      : "/portal/app/onboarding?step=knowledgeBase",
  );
}

export async function submitOnboardingAction() {
  await requirePracticeWidePortalAccess();

  const portalState = await getPortalWorkspaceState();

  if (!portalState.readyToLaunch) {
    redirect("/portal/app/onboarding?step=review");
  }

  await setPortalLaunchState(true);

  const workspaceUser = await getWorkspaceUser();

  if (workspaceUser) {
    await persistLaunchStateForUser(workspaceUser);
  }

  redirect("/portal/app/preparing");
}
