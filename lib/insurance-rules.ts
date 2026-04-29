import { revalidatePath } from "next/cache";

import type { Prisma } from "@/generated/prisma/client";
import { requireAdminSession } from "@/lib/admin-auth";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type InsuranceRuleRevisionStatus = "PENDING_APPROVAL" | "PUBLISHED" | "REJECTED";

type RawInsuranceRuleSet = Awaited<
  ReturnType<typeof loadInsuranceRuleSetsForPractice>
>[number];

export type InsuranceAliasRuleStatus =
  | "accepted"
  | "needs_clarification"
  | "not_accepted";

export type InsuranceAliasRule = {
  aliases: string[];
  canProceed: boolean;
  needsExactPlanName: boolean;
  status: InsuranceAliasRuleStatus;
  callerPlan?: string;
  clarificationNeeded?: string;
  family?: string;
};

export type InsuranceRulesPayload = {
  acceptedPlans: string[];
  aliasRules: InsuranceAliasRule[];
  notAcceptedPlans: string[];
  officeLabel: string;
};

export type InsuranceRuleRevisionSummary = {
  createdAt: Date;
  editedByUserId: string | null;
  id: string;
  publishedAt: Date | null;
  rules: InsuranceRulesPayload;
  rulesJson: string;
  status: InsuranceRuleRevisionStatus;
};

export type InsuranceRuleSetSummary = {
  id: string;
  locationName: string | null;
  pendingRevision: InsuranceRuleRevisionSummary | null;
  publishedRevision: InsuranceRuleRevisionSummary | null;
  slug: string;
  title: string;
};

export type PortalInsuranceRuleState = {
  ruleSets: InsuranceRuleSetSummary[];
  selectedRuleSet: InsuranceRuleSetSummary | null;
};

export type InsuranceRulesParseResult =
  | { ok: true; rules: InsuranceRulesPayload }
  | { error: string; ok: false };

const ABITA_INSURANCE_RULES = {
  officeLabel: "Spring Hill",
  aliasRules: [
    {
      aliases: ["Simply", "Simply Health", "Simply Health Plans"],
      status: "accepted",
      family: "Simply Medicaid",
      callerPlan: "Simply Health",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["BCBS Medicare HMO"],
      status: "accepted",
      family: "Florida Blue Medicare HMO",
      callerPlan: "Blue Cross Blue Shield Medicare HMO",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Blue Cross", "BCBS", "Blue Cross Blue Shield"],
      status: "accepted",
      family: "Florida Blue",
      callerPlan: "Blue Cross Blue Shield",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["UHC Medicare"],
      status: "accepted",
      family: "United Healthcare AARP Medicare",
      callerPlan: "United Healthcare Medicare",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["United", "UHC"],
      status: "accepted",
      family: "United Healthcare",
      callerPlan: "United Healthcare",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["DuoComplete"],
      status: "accepted",
      family: "United Healthcare Dual Complete",
      callerPlan: "DuoComplete",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Oscar", "Oscar Insurance"],
      status: "accepted",
      family: "Oscar Health",
      callerPlan: "Oscar",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Humana Medicare"],
      status: "accepted",
      family: "Humana Medicare",
      callerPlan: "Humana Medicare",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Humana"],
      status: "accepted",
      family: "Humana PPO",
      callerPlan: "Humana",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Cigna"],
      status: "accepted",
      family: "Cigna PPO",
      callerPlan: "Cigna",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Tricare"],
      status: "accepted",
      family: "Tricare Select",
      callerPlan: "Tricare",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Medicare"],
      status: "accepted",
      family: "Florida Medicare",
      callerPlan: "Medicare",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Molina"],
      status: "needs_clarification",
      clarificationNeeded: "Medicaid, Medicare, or Marketplace",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Aetna EPO"],
      status: "needs_clarification",
      clarificationNeeded: "which Aetna EPO plan: North Broward or University of Miami",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Sunshine"],
      status: "accepted",
      family: "Sunshine Medicaid",
      callerPlan: "Sunshine",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Wellcare"],
      status: "accepted",
      family: "Wellcare",
      callerPlan: "Wellcare",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Staywell"],
      status: "accepted",
      family: "Staywell Medicare",
      callerPlan: "Staywell",
      canProceed: true,
      needsExactPlanName: true,
    },
  ],
  acceptedPlans: [
    "Aetna",
    "Aetna Better Health",
    "Aetna Better Health of Florida",
    "Aetna EPO North Broward",
    "Aetna EPO University of Miami",
    "Aetna Healthy Kids",
    "Aetna HMO",
    "Aetna Medicare HMO",
    "Aetna Medicare Signature PPO",
    "Aetna QHP Individual Exchange",
    "Ambetter",
    "Ambetter Premier",
    "Ambetter Select",
    "Ambetter Value",
    "AvMed",
    "AvMed Medicare Advantage",
    "Children's Medical Services",
    "Cigna HMO",
    "Cigna Local Plus",
    "Cigna Medicare Advantage",
    "Cigna Miami-Dade Public Schools",
    "Cigna Open Access",
    "Cigna PPO",
    "Community Care Plan",
    "Doctors Health Medicare",
    "Envolve Vision",
    "Eye America AAO",
    "Eye Care Health Solutions",
    "Florida Blue",
    "Florida Blue HMO",
    "Florida Blue Medicare HMO",
    "Florida Blue Medicare PPO",
    "Florida Blue PPO Federal Employee",
    "Florida Blue PPO Out of State",
    "Florida Blue Steward Tier 1",
    "Florida BlueSelect",
    "Florida Community Care",
    "Florida Complete Care",
    "Florida Medicaid",
    "Florida Medicare",
    "Humana Gold Plus",
    "Humana Healthy Horizons",
    "Humana Medicaid",
    "Humana Medicare",
    "Humana PPO",
    "iCare",
    "Imagine Health",
    "Medicaid",
    "Meritain Health",
    "Miami Children's Health Plan",
    "Molina Marketplace",
    "Molina Medicaid",
    "Molina Medicare",
    "Multiplan PHCS",
    "Oscar Health",
    "Preferred Care Partners",
    "Simply Medicaid",
    "Simply Health",
    "Staywell Medicare",
    "SunHealth",
    "Sunshine Health",
    "Sunshine Medicaid",
    "Tricare for Life",
    "Tricare Forever",
    "Tricare Prime",
    "Tricare Select",
    "UMR",
    "United Healthcare",
    "United Healthcare AARP Medicare",
    "United Healthcare All Savers",
    "United Healthcare Choice",
    "United Healthcare Dual Complete",
    "United Healthcare Global",
    "United Healthcare Golden Rule",
    "United Healthcare HMO",
    "United Healthcare Individual Exchange",
    "United Healthcare NHP",
    "United Healthcare Shared Services",
    "United Healthcare Student Resources",
    "United Healthcare Surest",
    "Vivida",
    "Wellcare",
  ],
  notAcceptedPlans: [
    "Care Plus",
    "Optimum Healthcare",
    "Care Health Plus",
    "Humana Care Plus",
    "Humana HMO",
    "Humana Premier HMO",
  ],
} satisfies InsuranceRulesPayload;

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: string | null | undefined) {
  return (value || "").trim();
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function listFromText(value: string | null | undefined) {
  return textValue(value)
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "insurance-rules";
}

function isRuleStatus(value: unknown): value is InsuranceAliasRuleStatus {
  return (
    value === "accepted" || value === "needs_clarification" || value === "not_accepted"
  );
}

function cloneRules(
  rules: InsuranceRulesPayload,
  officeLabel: string,
): InsuranceRulesPayload {
  return {
    officeLabel,
    aliasRules: rules.aliasRules.map((rule) => ({ ...rule, aliases: [...rule.aliases] })),
    acceptedPlans: [...rules.acceptedPlans],
    notAcceptedPlans: [...rules.notAcceptedPlans],
  };
}

export function stringifyInsuranceRules(rules: InsuranceRulesPayload) {
  return JSON.stringify(rules, null, 2);
}

export function parseInsuranceRulesJson(json: string): InsuranceRulesParseResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      error: "Insurance rules must be valid JSON.",
      ok: false,
    };
  }

  if (!isRecord(parsed)) {
    return {
      error: "Insurance rules must be a JSON object.",
      ok: false,
    };
  }

  const officeLabel =
    typeof parsed.officeLabel === "string" ? parsed.officeLabel.trim() : "";
  const acceptedPlans = stringList(parsed.acceptedPlans);
  const notAcceptedPlans = stringList(parsed.notAcceptedPlans);

  if (!officeLabel) {
    return {
      error: "Insurance rules need an officeLabel.",
      ok: false,
    };
  }

  if (!Array.isArray(parsed.aliasRules)) {
    return {
      error: "Insurance rules need aliasRules as an array.",
      ok: false,
    };
  }

  const aliasRules: InsuranceAliasRule[] = [];

  for (const [index, item] of parsed.aliasRules.entries()) {
    if (!isRecord(item)) {
      return {
        error: `Alias rule ${index + 1} must be an object.`,
        ok: false,
      };
    }

    const aliases = stringList(item.aliases);

    if (!aliases.length) {
      return {
        error: `Alias rule ${index + 1} needs at least one alias.`,
        ok: false,
      };
    }

    if (!isRuleStatus(item.status)) {
      return {
        error: `Alias rule ${index + 1} has an invalid status.`,
        ok: false,
      };
    }

    if (typeof item.canProceed !== "boolean") {
      return {
        error: `Alias rule ${index + 1} needs a boolean canProceed value.`,
        ok: false,
      };
    }

    if (typeof item.needsExactPlanName !== "boolean") {
      return {
        error: `Alias rule ${index + 1} needs a boolean needsExactPlanName value.`,
        ok: false,
      };
    }

    aliasRules.push({
      aliases,
      status: item.status,
      canProceed: item.canProceed,
      needsExactPlanName: item.needsExactPlanName,
      ...(typeof item.callerPlan === "string" && item.callerPlan.trim()
        ? { callerPlan: item.callerPlan.trim() }
        : {}),
      ...(typeof item.clarificationNeeded === "string" && item.clarificationNeeded.trim()
        ? { clarificationNeeded: item.clarificationNeeded.trim() }
        : {}),
      ...(typeof item.family === "string" && item.family.trim()
        ? { family: item.family.trim() }
        : {}),
    });
  }

  return {
    ok: true,
    rules: {
      officeLabel,
      aliasRules,
      acceptedPlans,
      notAcceptedPlans,
    },
  };
}

export function normalizeInsuranceRulesForView(
  value: unknown,
  fallbackOfficeLabel: string,
): InsuranceRulesPayload {
  const parsed = parseInsuranceRulesJson(JSON.stringify(value ?? {}));

  if (parsed.ok) {
    return parsed.rules;
  }

  return {
    officeLabel: fallbackOfficeLabel,
    aliasRules: [],
    acceptedPlans: [],
    notAcceptedPlans: [],
  };
}

function buildLegacyRules(
  practice: {
    insuranceCrosswalk: {
      acceptedPlans: string | null;
      exceptions: string | null;
    } | null;
    name: string;
  },
  officeLabel: string,
): InsuranceRulesPayload {
  return {
    officeLabel,
    aliasRules: [],
    acceptedPlans: listFromText(practice.insuranceCrosswalk?.acceptedPlans),
    notAcceptedPlans: listFromText(practice.insuranceCrosswalk?.exceptions),
  };
}

function findSpringHillLocation(
  locations: Array<{ address: string | null; id: string; name: string }>,
) {
  return (
    locations.find((location) =>
      `${location.name} ${location.address || ""}`.toLowerCase().includes("spring"),
    ) ?? null
  );
}

function findCrystalRiverLocation(
  locations: Array<{ address: string | null; id: string; name: string }>,
) {
  return (
    locations.find((location) =>
      `${location.name} ${location.address || ""}`.toLowerCase().includes("crystal"),
    ) ??
    locations.find((location) =>
      `${location.name} ${location.address || ""}`.toLowerCase().includes("lyle"),
    ) ??
    null
  );
}

function getSeedRuleSetsForPractice(practice: {
  id: string;
  insuranceCrosswalk: {
    acceptedPlans: string | null;
    exceptions: string | null;
  } | null;
  locations: Array<{
    address: string | null;
    id: string;
    isPrimary: boolean;
    name: string;
  }>;
  name: string;
}) {
  const isAbita = practice.name.toLowerCase().includes("abita");

  if (isAbita) {
    const springHillLocation = findSpringHillLocation(practice.locations);
    const crystalRiverLocation = findCrystalRiverLocation(practice.locations);

    return [
      {
        locationId: springHillLocation?.id ?? null,
        rules: cloneRules(ABITA_INSURANCE_RULES, "Spring Hill"),
        slug: "spring-hill-insurance-rules",
        title: "Insurance Rules: Abita Eye Group, Spring Hill",
      },
      {
        locationId: crystalRiverLocation?.id ?? null,
        rules: cloneRules(ABITA_INSURANCE_RULES, "Crystal River"),
        slug: "crystal-river-insurance-rules",
        title: "Insurance Rules: Eye Radiance, Crystal River",
      },
    ];
  }

  const locations = practice.locations.length
    ? practice.locations
    : [{ address: null, id: "", isPrimary: true, name: practice.name }];

  return locations.map((location) => {
    const officeLabel = location.name || practice.name;

    return {
      locationId: location.id || null,
      rules: buildLegacyRules(practice, officeLabel),
      slug: slugify(`${officeLabel} insurance rules`),
      title: `Insurance Rules: ${officeLabel}`,
    };
  });
}

async function loadInsuranceRuleSetsForPractice(practiceId: string) {
  return prisma.practiceInsuranceRuleSet.findMany({
    include: {
      location: {
        select: {
          name: true,
        },
      },
      revisions: {
        orderBy: {
          createdAt: "desc",
        },
        take: 25,
      },
    },
    orderBy: [{ createdAt: "asc" }],
    where: {
      practiceId,
      status: "ACTIVE",
    },
  });
}

function summarizeRevision(
  revision: RawInsuranceRuleSet["revisions"][number] | undefined,
  fallbackOfficeLabel: string,
): InsuranceRuleRevisionSummary | null {
  if (!revision) {
    return null;
  }

  const rules = normalizeInsuranceRulesForView(revision.rules, fallbackOfficeLabel);

  return {
    createdAt: revision.createdAt,
    editedByUserId: revision.editedByUserId,
    id: revision.id,
    publishedAt: revision.publishedAt,
    rules,
    rulesJson: stringifyInsuranceRules(rules),
    status: revision.status,
  };
}

function summarizeRuleSet(ruleSet: RawInsuranceRuleSet): InsuranceRuleSetSummary {
  const fallbackOfficeLabel =
    ruleSet.location?.name ?? ruleSet.title.replace(/^Insurance Rules:\s*/i, "");
  const publishedRevision = ruleSet.revisions.find(
    (revision) => revision.status === "PUBLISHED",
  );
  const pendingRevision = ruleSet.revisions.find(
    (revision) => revision.status === "PENDING_APPROVAL",
  );

  return {
    id: ruleSet.id,
    locationName: ruleSet.location?.name ?? null,
    pendingRevision: summarizeRevision(pendingRevision, fallbackOfficeLabel),
    publishedRevision: summarizeRevision(publishedRevision, fallbackOfficeLabel),
    slug: ruleSet.slug,
    title: ruleSet.title,
  };
}

async function ensureDefaultInsuranceRuleSets(practiceId: string) {
  const existingRuleSets = await prisma.practiceInsuranceRuleSet.findMany({
    select: {
      slug: true,
    },
    where: {
      practiceId,
      status: "ACTIVE",
    },
  });
  const existingSlugs = new Set(existingRuleSets.map((ruleSet) => ruleSet.slug));

  const practice = await prisma.practice.findUnique({
    include: {
      insuranceCrosswalk: true,
      locations: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    },
    where: {
      id: practiceId,
    },
  });

  if (!practice) {
    return;
  }

  const seedRuleSets = getSeedRuleSetsForPractice(practice).filter(
    (ruleSet) => !existingSlugs.has(ruleSet.slug),
  );

  for (const seedRuleSet of seedRuleSets) {
    await prisma.practiceInsuranceRuleSet.create({
      data: {
        locationId: seedRuleSet.locationId,
        practiceId,
        revisions: {
          create: {
            publishedAt: new Date(),
            rules: jsonInput(seedRuleSet.rules),
            source: "IMPORT",
            status: "PUBLISHED",
          },
        },
        slug: seedRuleSet.slug,
        title: seedRuleSet.title,
      },
    });
  }
}

export async function getPortalInsuranceRuleState(
  selectedSlug?: string,
): Promise<PortalInsuranceRuleState | null> {
  const session = await getAuthSession();

  if (!session) {
    return null;
  }

  const membership = await prisma.practiceMembership.findFirst({
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: {
      practiceId: true,
    },
    where: {
      userId: session.user.id,
    },
  });

  if (!membership) {
    return null;
  }

  await ensureDefaultInsuranceRuleSets(membership.practiceId);

  const ruleSets = (await loadInsuranceRuleSetsForPractice(membership.practiceId)).map(
    summarizeRuleSet,
  );
  const selectedRuleSet =
    ruleSets.find((ruleSet) => ruleSet.slug === selectedSlug) ?? ruleSets[0] ?? null;

  return {
    ruleSets,
    selectedRuleSet,
  };
}

export async function submitInsuranceRuleDraftForReview({
  ruleSetId,
  rulesJson,
}: {
  ruleSetId: string;
  rulesJson: string;
}) {
  const session = await getAuthSession();

  if (!session) {
    return null;
  }

  const ruleSet = await prisma.practiceInsuranceRuleSet.findFirst({
    include: {
      practice: {
        select: {
          name: true,
        },
      },
      revisions: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        where: {
          status: "PUBLISHED",
        },
      },
    },
    where: {
      id: ruleSetId,
      practice: {
        memberships: {
          some: {
            userId: session.user.id,
          },
        },
      },
      status: "ACTIVE",
    },
  });

  if (!ruleSet) {
    return null;
  }

  const parsed = parseInsuranceRulesJson(rulesJson);

  if (!parsed.ok) {
    return {
      changed: false,
      error: parsed.error,
      invalid: true,
      slug: ruleSet.slug,
    };
  }

  const normalizedRulesJson = stringifyInsuranceRules(parsed.rules);
  const latestPublishedRules = normalizeInsuranceRulesForView(
    ruleSet.revisions[0]?.rules,
    parsed.rules.officeLabel,
  );
  const latestPublishedJson = stringifyInsuranceRules(latestPublishedRules);

  if (normalizedRulesJson === latestPublishedJson) {
    return {
      changed: false,
      slug: ruleSet.slug,
    };
  }

  const revision = await prisma.practiceInsuranceRuleRevision.create({
    data: {
      editedByUserId: session.user.id,
      ruleSetId: ruleSet.id,
      rules: jsonInput(parsed.rules),
      source: "PRACTICE",
      status: "PENDING_APPROVAL",
    },
  });

  await prisma.adminAlert.create({
    data: {
      insuranceRuleRevisionId: revision.id,
      insuranceRuleSetId: ruleSet.id,
      message: `${ruleSet.practice.name} edited ${ruleSet.title}.`,
      practiceId: ruleSet.practiceId,
      type: "INSURANCE_RULES_EDITED",
    },
  });

  revalidatePath("/portal/app/insurance-crosswalk");
  revalidatePath("/admin/insurance-rules");

  return {
    changed: true,
    slug: ruleSet.slug,
  };
}

export async function getPendingInsuranceRuleReviews() {
  return prisma.adminAlert.findMany({
    include: {
      insuranceRuleRevision: true,
      insuranceRuleSet: {
        include: {
          location: {
            select: {
              name: true,
            },
          },
          revisions: {
            orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
            take: 1,
            where: {
              status: "PUBLISHED",
            },
          },
        },
      },
      practice: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    where: {
      insuranceRuleRevision: {
        status: "PENDING_APPROVAL",
      },
      status: {
        in: ["UNREAD", "REVIEWING"],
      },
      type: "INSURANCE_RULES_EDITED",
    },
  });
}

export async function approveInsuranceRuleRevision(alertId: string) {
  const session = await requireAdminSession();

  await prisma.$transaction(async (tx) => {
    const alert = await tx.adminAlert.findUnique({
      include: {
        insuranceRuleRevision: true,
        insuranceRuleSet: true,
      },
      where: {
        id: alertId,
      },
    });

    if (!alert?.insuranceRuleRevision || !alert.insuranceRuleSet) {
      return;
    }

    const now = new Date();

    await tx.practiceInsuranceRuleRevision.update({
      data: {
        publishedAt: now,
        reviewedAt: now,
        reviewedByUserId: session.user.id,
        status: "PUBLISHED",
      },
      where: {
        id: alert.insuranceRuleRevision.id,
      },
    });

    await tx.practiceInsuranceRuleSet.update({
      data: {
        updatedAt: now,
      },
      where: {
        id: alert.insuranceRuleSet.id,
      },
    });

    await tx.adminAlert.updateMany({
      data: {
        resolvedAt: now,
        status: "RESOLVED",
      },
      where: {
        insuranceRuleRevisionId: alert.insuranceRuleRevision.id,
      },
    });
  });

  revalidatePath("/admin/insurance-rules");
  revalidatePath("/portal/app/insurance-crosswalk");
}

export async function rejectInsuranceRuleRevision(alertId: string, reviewNote: string) {
  const session = await requireAdminSession();

  await prisma.$transaction(async (tx) => {
    const alert = await tx.adminAlert.findUnique({
      include: {
        insuranceRuleRevision: true,
      },
      where: {
        id: alertId,
      },
    });

    if (!alert?.insuranceRuleRevision) {
      return;
    }

    const now = new Date();

    await tx.practiceInsuranceRuleRevision.update({
      data: {
        reviewNote: reviewNote.trim() || null,
        reviewedAt: now,
        reviewedByUserId: session.user.id,
        status: "REJECTED",
      },
      where: {
        id: alert.insuranceRuleRevision.id,
      },
    });

    await tx.adminAlert.updateMany({
      data: {
        resolvedAt: now,
        status: "RESOLVED",
      },
      where: {
        insuranceRuleRevisionId: alert.insuranceRuleRevision.id,
      },
    });
  });

  revalidatePath("/admin/insurance-rules");
  revalidatePath("/portal/app/insurance-crosswalk");
}
