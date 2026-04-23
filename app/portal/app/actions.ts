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
} from "@/lib/practice-workspace";
import { scanPracticeWebsite } from "@/lib/website-scan";
import {
  getPortalWorkspaceState,
  setPortalLaunchState,
  setPortalSectionCompletion,
  updatePortalDraftState,
} from "@/lib/portal-state";

function readTextField(formData: FormData, key: string, maxLength = 240) {
  return String(formData.get(key) || "")
    .trim()
    .slice(0, maxLength);
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

export async function scanPracticeWebsiteAction(formData: FormData) {
  const websiteUrl = normalizeWebsiteUrl(readTextField(formData, "websiteUrl", 200));

  if (!websiteUrl) {
    redirect("/portal/app/onboarding?step=website");
  }

  const scanResult = await scanPracticeWebsite(websiteUrl);
  const primaryLocation = scanResult.primaryLocation;
  const primaryProvider = scanResult.providers[0];
  const workspaceUser = await getWorkspaceUser();

  await updatePortalDraftState({
    address: primaryLocation?.address || "",
    fax: primaryLocation?.fax || "",
    locationName: primaryLocation?.name || "",
    phone: primaryLocation?.phone || "",
    practiceName: scanResult.practiceName || "",
    providerLocation: primaryLocation?.name || "",
    providerName: primaryProvider?.displayName || "",
    providerNpi: primaryProvider?.npi || "",
    providerSpecialty: primaryProvider?.specialtySummary || "",
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
  const input = {
    address: readTextField(formData, "address"),
    fax: readTextField(formData, "fax", 80),
    locationName: readTextField(formData, "locationName"),
    phone: readTextField(formData, "phone", 80),
    practiceName: readTextField(formData, "practiceName", 120),
  };
  const workspaceUser = await getWorkspaceUser();

  await updatePortalDraftState(input);
  await setPortalSectionCompletion("practiceProfile", true);

  if (workspaceUser) {
    await persistPracticeBasicsForUser(workspaceUser, input);
  }

  redirect("/portal/app/onboarding?step=providerRouting");
}

export async function saveProviderSetupAction(formData: FormData) {
  const input = {
    providerHours: readTextField(formData, "providerHours"),
    providerLocation: readTextField(formData, "providerLocation"),
    providerName: readTextField(formData, "providerName"),
    providerNpi: readTextField(formData, "providerNpi", 30),
    providerSchedulingNotes: readTextField(formData, "providerSchedulingNotes", 240),
    providerSpecialty: readTextField(formData, "providerSpecialty"),
  };
  const workspaceUser = await getWorkspaceUser();

  await updatePortalDraftState(input);
  await setPortalSectionCompletion("providerRouting", true);

  if (workspaceUser) {
    await persistProviderSetupForUser(workspaceUser, input);
  }

  redirect("/portal/app/onboarding?step=insuranceCrosswalk");
}

export async function saveKnowledgeBaseAction(formData: FormData) {
  const input = {
    knowledgeAfterHours: readTextField(formData, "knowledgeAfterHours", 320),
    knowledgeAppointmentPrep: readTextField(
      formData,
      "knowledgeAppointmentPrep",
      320
    ),
    knowledgeCommonQuestions: readTextField(
      formData,
      "knowledgeCommonQuestions",
      320
    ),
    knowledgeOfficePolicies: readTextField(formData, "knowledgeOfficePolicies", 320),
    knowledgePhrases: readTextField(formData, "knowledgePhrases", 320),
  };
  const workspaceUser = await getWorkspaceUser();

  await updatePortalDraftState(input);
  await setPortalSectionCompletion("knowledgeBase", true);

  if (workspaceUser) {
    await persistKnowledgeBaseForUser(workspaceUser, input);
  }

  const portalState = await getPortalWorkspaceState();

  redirect(
    portalState.launched ? "/portal/app/overview" : "/portal/app/onboarding?step=review"
  );
}

export async function saveInsuranceCrosswalkAction(formData: FormData) {
  const input = {
    insuranceAcceptedPlans: readTextField(formData, "insuranceAcceptedPlans", 320),
    insuranceExceptions: readTextField(formData, "insuranceExceptions", 320),
    insuranceTransferRules: readTextField(formData, "insuranceTransferRules", 320),
  };
  const workspaceUser = await getWorkspaceUser();

  await updatePortalDraftState(input);
  await setPortalSectionCompletion("insuranceCrosswalk", true);

  if (workspaceUser) {
    await persistInsuranceCrosswalkForUser(workspaceUser, input);
  }

  const portalState = await getPortalWorkspaceState();

  redirect(
    portalState.launched ? "/portal/app/overview" : "/portal/app/onboarding?step=knowledgeBase"
  );
}

export async function launchPortalAction() {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.readyToLaunch) {
    redirect("/portal/app/onboarding?step=review");
  }

  await setPortalLaunchState(true);

  const workspaceUser = await getWorkspaceUser();

  if (workspaceUser) {
    await persistLaunchStateForUser(workspaceUser);
  }

  redirect("/portal/app/overview");
}
