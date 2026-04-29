import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isExplicitAdminEmail } from "./admin-auth";
import { getAuthSession } from "./auth";
import { emptyPracticeBranding, type PracticeBranding } from "./practice-branding";
import {
  getPracticeWorkspaceSnapshotForUser,
  hasPracticeWorkspaceTables,
  type PracticeLocationDraft,
  type PracticeProviderDraft,
} from "./practice-workspace";

export const PORTAL_STATE_COOKIE = "acuity_portal_state";

type PortalDraftState = {
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

type PortalSectionDefinition = {
  description: string;
  href?: string;
  key:
    | "practiceProfile"
    | "providerRouting"
    | "insuranceCrosswalk"
    | "knowledgeBase"
    | "rulesAndEscalations";
  label: string;
};

export const portalSectionDefinitions = [
  {
    key: "practiceProfile",
    label: "Practice basics",
    description: "Practice name, location, phone, fax, and address.",
  },
  {
    key: "providerRouting",
    label: "Providers and locations",
    description: "Provider name, specialty, NPI, hours, and scheduling notes.",
  },
  {
    key: "insuranceCrosswalk",
    label: "Insurance crosswalk",
    description: "Accepted plans, exceptions, and when to transfer to staff.",
    href: "/portal/app/insurance-crosswalk",
  },
  {
    key: "knowledgeBase",
    label: "Knowledge base",
    description: "FAQs, prep, policies, after-hours rules, and required phrases.",
    href: "/portal/app/knowledge-base",
  },
  {
    key: "rulesAndEscalations",
    label: "Rules and escalations",
    description: "Urgent scenarios and escalation language already approved.",
  },
] as const satisfies readonly PortalSectionDefinition[];

export type PortalSectionKey = PortalSectionDefinition["key"];

type PortalCookieState = {
  draft: PortalDraftState;
  launched: boolean;
} & Record<PortalSectionKey, boolean>;

export type PortalWorkspaceState = {
  branding: PracticeBranding;
  completionCount: number;
  draft: PortalDraftState;
  launched: boolean;
  missingSections: PortalSection[];
  nextAction: PortalSection | null;
  readyToLaunch: boolean;
  sections: PortalSection[];
  totalSections: number;
};

export type PortalSection = PortalSectionDefinition & {
  complete: boolean;
};

const defaultPortalDraft: PortalDraftState = {
  address: "",
  fax: "",
  insuranceAcceptedPlans: "",
  insuranceExceptions: "",
  insuranceTransferRules: "",
  knowledgeAfterHours: "",
  knowledgeAppointmentPrep: "",
  knowledgeCommonQuestions: "",
  knowledgeOfficePolicies: "",
  knowledgePhrases: "",
  locations: [],
  locationName: "",
  phone: "",
  practiceName: "",
  providers: [],
  providerHours: "",
  providerLocation: "",
  providerName: "",
  providerNpi: "",
  providerSchedulingNotes: "",
  providerSpecialty: "",
  websiteUrl: "",
};

const defaultPortalState: PortalCookieState = {
  draft: defaultPortalDraft,
  launched: false,
  practiceProfile: false,
  providerRouting: false,
  insuranceCrosswalk: false,
  knowledgeBase: false,
  rulesAndEscalations: true,
};

function buildPortalWorkspaceState({
  branding = emptyPracticeBranding,
  draft,
  launched,
  practiceProfile,
  providerRouting,
  insuranceCrosswalk,
  knowledgeBase,
  rulesAndEscalations,
}: {
  branding?: PracticeBranding;
  draft: PortalDraftState;
  insuranceCrosswalk: boolean;
  knowledgeBase: boolean;
  launched: boolean;
  practiceProfile: boolean;
  providerRouting: boolean;
  rulesAndEscalations: boolean;
}): PortalWorkspaceState {
  const completionMap: Record<PortalSectionKey, boolean> = {
    insuranceCrosswalk,
    knowledgeBase,
    practiceProfile,
    providerRouting,
    rulesAndEscalations,
  };
  const sections = portalSectionDefinitions.map((section) => ({
    ...section,
    complete: completionMap[section.key],
  }));
  const missingSections = sections.filter((section) => !section.complete);
  const readyToLaunch = missingSections.length === 0;

  return {
    branding,
    completionCount: sections.filter((section) => section.complete).length,
    draft,
    launched,
    missingSections,
    nextAction: missingSections[0] ?? null,
    readyToLaunch,
    sections,
    totalSections: sections.length,
  };
}

function parseProviderDrafts(
  rawDraft: Partial<PortalDraftState> | undefined,
): PracticeProviderDraft[] {
  if (Array.isArray(rawDraft?.providers)) {
    return rawDraft.providers
      .map((provider) => ({
        id: provider.id,
        providerHours: provider.providerHours ?? "",
        providerLocation: provider.providerLocation ?? "",
        providerName: provider.providerName ?? "",
        providerNpi: provider.providerNpi ?? "",
        providerSchedulingNotes: provider.providerSchedulingNotes ?? "",
        providerSpecialty: provider.providerSpecialty ?? "",
      }))
      .filter((provider) =>
        Object.entries(provider).some(
          ([key, value]) => key !== "id" && Boolean(String(value || "").trim()),
        ),
      );
  }

  if (rawDraft?.providerName) {
    return [
      {
        providerHours: rawDraft.providerHours ?? "",
        providerLocation: rawDraft.providerLocation ?? "",
        providerName: rawDraft.providerName,
        providerNpi: rawDraft.providerNpi ?? "",
        providerSchedulingNotes: rawDraft.providerSchedulingNotes ?? "",
        providerSpecialty: rawDraft.providerSpecialty ?? "",
      },
    ];
  }

  return [];
}

function parseLocationDrafts(
  rawDraft: Partial<PortalDraftState> | undefined,
): PracticeLocationDraft[] {
  if (Array.isArray(rawDraft?.locations)) {
    return rawDraft.locations
      .map((location) => ({
        address: location.address ?? "",
        fax: location.fax ?? "",
        hours: location.hours ?? "",
        id: location.id,
        insuranceNotes: location.insuranceNotes ?? "",
        insuranceVaries: location.insuranceVaries === true,
        knowledgeNotes: location.knowledgeNotes ?? "",
        knowledgeVaries: location.knowledgeVaries === true,
        locationName: location.locationName ?? "",
        phone: location.phone ?? "",
      }))
      .filter((location) =>
        [
          location.address,
          location.fax,
          location.hours,
          location.insuranceNotes,
          location.knowledgeNotes,
          location.locationName,
          location.phone,
        ].some((value) => Boolean(String(value || "").trim())),
      );
  }

  if (rawDraft?.locationName || rawDraft?.address || rawDraft?.phone) {
    return [
      {
        address: rawDraft.address ?? "",
        fax: rawDraft.fax ?? "",
        hours: "",
        insuranceNotes: "",
        insuranceVaries: false,
        knowledgeNotes: "",
        knowledgeVaries: false,
        locationName: rawDraft.locationName ?? "",
        phone: rawDraft.phone ?? "",
      },
    ];
  }

  return [];
}

function parsePortalDraft(
  rawDraft: Partial<PortalDraftState> | undefined,
): PortalDraftState {
  const locations = parseLocationDrafts(rawDraft);
  const primaryLocation = locations[0];
  const providers = parseProviderDrafts(rawDraft);
  const primaryProvider = providers[0];

  return {
    address: primaryLocation?.address ?? rawDraft?.address ?? defaultPortalDraft.address,
    fax: primaryLocation?.fax ?? rawDraft?.fax ?? defaultPortalDraft.fax,
    insuranceAcceptedPlans:
      rawDraft?.insuranceAcceptedPlans ?? defaultPortalDraft.insuranceAcceptedPlans,
    insuranceExceptions:
      rawDraft?.insuranceExceptions ?? defaultPortalDraft.insuranceExceptions,
    insuranceTransferRules:
      rawDraft?.insuranceTransferRules ?? defaultPortalDraft.insuranceTransferRules,
    knowledgeAfterHours:
      rawDraft?.knowledgeAfterHours ?? defaultPortalDraft.knowledgeAfterHours,
    knowledgeAppointmentPrep:
      rawDraft?.knowledgeAppointmentPrep ?? defaultPortalDraft.knowledgeAppointmentPrep,
    knowledgeCommonQuestions:
      rawDraft?.knowledgeCommonQuestions ?? defaultPortalDraft.knowledgeCommonQuestions,
    knowledgeOfficePolicies:
      rawDraft?.knowledgeOfficePolicies ?? defaultPortalDraft.knowledgeOfficePolicies,
    knowledgePhrases: rawDraft?.knowledgePhrases ?? defaultPortalDraft.knowledgePhrases,
    locations,
    locationName:
      primaryLocation?.locationName ??
      rawDraft?.locationName ??
      defaultPortalDraft.locationName,
    phone: primaryLocation?.phone ?? rawDraft?.phone ?? defaultPortalDraft.phone,
    practiceName: rawDraft?.practiceName ?? defaultPortalDraft.practiceName,
    providers,
    providerHours:
      primaryProvider?.providerHours ??
      rawDraft?.providerHours ??
      defaultPortalDraft.providerHours,
    providerLocation:
      primaryProvider?.providerLocation ??
      rawDraft?.providerLocation ??
      defaultPortalDraft.providerLocation,
    providerName:
      primaryProvider?.providerName ??
      rawDraft?.providerName ??
      defaultPortalDraft.providerName,
    providerNpi:
      primaryProvider?.providerNpi ??
      rawDraft?.providerNpi ??
      defaultPortalDraft.providerNpi,
    providerSchedulingNotes:
      primaryProvider?.providerSchedulingNotes ??
      rawDraft?.providerSchedulingNotes ??
      defaultPortalDraft.providerSchedulingNotes,
    providerSpecialty:
      primaryProvider?.providerSpecialty ??
      rawDraft?.providerSpecialty ??
      defaultPortalDraft.providerSpecialty,
    websiteUrl: rawDraft?.websiteUrl ?? defaultPortalDraft.websiteUrl,
  };
}

function parsePortalCookie(rawValue: string | undefined): PortalCookieState {
  if (!rawValue) {
    return defaultPortalState;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PortalCookieState>;

    return {
      draft: parsePortalDraft(parsed.draft),
      launched: parsed.launched === true,
      practiceProfile: parsed.practiceProfile ?? defaultPortalState.practiceProfile,
      providerRouting: parsed.providerRouting ?? defaultPortalState.providerRouting,
      insuranceCrosswalk:
        parsed.insuranceCrosswalk ?? defaultPortalState.insuranceCrosswalk,
      knowledgeBase: parsed.knowledgeBase ?? defaultPortalState.knowledgeBase,
      rulesAndEscalations:
        parsed.rulesAndEscalations ?? defaultPortalState.rulesAndEscalations,
    };
  } catch {
    return defaultPortalState;
  }
}

async function readPortalCookieState() {
  const cookieStore = await cookies();

  return parsePortalCookie(cookieStore.get(PORTAL_STATE_COOKIE)?.value);
}

async function shouldWritePortalCookieFallback() {
  const session = await getAuthSession();

  if (!session) {
    return true;
  }

  return !(await hasPracticeWorkspaceTables());
}

function writePortalCookie(cookieState: PortalCookieState) {
  return cookies().then((cookieStore) => {
    cookieStore.set(PORTAL_STATE_COOKIE, JSON.stringify(cookieState), {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
      path: "/portal/app",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  });
}

async function getPortalWorkspaceStateFromCookie() {
  const cookieState = await readPortalCookieState();

  return buildPortalWorkspaceState({
    draft: cookieState.draft,
    insuranceCrosswalk: cookieState.insuranceCrosswalk,
    knowledgeBase: cookieState.knowledgeBase,
    launched: cookieState.launched,
    practiceProfile: cookieState.practiceProfile,
    providerRouting: cookieState.providerRouting,
    rulesAndEscalations: cookieState.rulesAndEscalations,
  });
}

async function getPortalWorkspaceStateFromDatabase() {
  const session = await getAuthSession();

  if (!session) {
    return null;
  }

  if (isExplicitAdminEmail(session.user.email)) {
    redirect("/admin/practices");
  }

  const workspaceSnapshot = await getPracticeWorkspaceSnapshotForUser({
    email: session.user.email,
    id: session.user.id,
    name: session.user.name,
  });

  if (!workspaceSnapshot) {
    return null;
  }

  return buildPortalWorkspaceState({
    branding: workspaceSnapshot.branding,
    draft: workspaceSnapshot.draft,
    insuranceCrosswalk: workspaceSnapshot.insuranceCrosswalkComplete,
    knowledgeBase: workspaceSnapshot.knowledgeBaseComplete,
    launched: workspaceSnapshot.launched,
    practiceProfile: workspaceSnapshot.practiceProfileComplete,
    providerRouting: workspaceSnapshot.providerRoutingComplete,
    rulesAndEscalations: workspaceSnapshot.rulesAndEscalationsComplete,
  });
}

export async function getPortalWorkspaceState(): Promise<PortalWorkspaceState> {
  const databaseState = await getPortalWorkspaceStateFromDatabase();

  if (databaseState) {
    return databaseState;
  }

  return getPortalWorkspaceStateFromCookie();
}

export async function setPortalSectionCompletion(
  key: PortalSectionKey,
  complete: boolean,
) {
  if (!(await shouldWritePortalCookieFallback())) {
    return;
  }

  const currentState = await readPortalCookieState();

  await writePortalCookie({
    ...currentState,
    [key]: complete,
  });
}

export async function updatePortalDraftState(draftPatch: Partial<PortalDraftState>) {
  if (!(await shouldWritePortalCookieFallback())) {
    return;
  }

  const currentState = await readPortalCookieState();

  await writePortalCookie({
    ...currentState,
    draft: {
      ...currentState.draft,
      ...draftPatch,
    },
  });
}

export async function setPortalLaunchState(launched: boolean) {
  if (!(await shouldWritePortalCookieFallback())) {
    return;
  }

  const currentState = await readPortalCookieState();

  await writePortalCookie({
    ...currentState,
    launched,
  });
}
