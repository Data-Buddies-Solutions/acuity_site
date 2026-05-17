import { revalidatePath } from "next/cache";

import type { Prisma } from "@/generated/prisma/client";
import { requireAdminSession } from "@/lib/admin-auth";
import {
  ABITA_HOLLYWOOD_SWEETWATER_INSURANCE_RULES,
  findAbitaNewOfficeByLocation,
} from "@/lib/abita-office-data";
import {
  buildPortalLocationScopeWhere,
  getCurrentPortalPracticeContext,
} from "@/lib/portal-access";
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

const ABITA_NEW_OFFICE_INSURANCE_RULES =
  ABITA_HOLLYWOOD_SWEETWATER_INSURANCE_RULES as InsuranceRulesPayload;

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
      aliases: ["Humana PPO"],
      status: "accepted",
      family: "Humana PPO",
      callerPlan: "Humana PPO",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Cigna Medicare Advantage"],
      status: "accepted",
      family: "Cigna Medicare Advantage",
      callerPlan: "Cigna Medicare Advantage",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Cigna PPO"],
      status: "accepted",
      family: "Cigna PPO",
      callerPlan: "Cigna PPO",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Cigna Open Access"],
      status: "accepted",
      family: "Cigna Open Access",
      callerPlan: "Cigna Open Access",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Cigna HMO"],
      status: "accepted",
      family: "Cigna HMO",
      callerPlan: "Cigna HMO",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Humana"],
      status: "needs_clarification",
      clarificationNeeded: "which Humana plan is on the card",
      canProceed: false,
      needsExactPlanName: false,
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
    {
      aliases: ["Aetna EPO"],
      status: "not_accepted",
      family: "Aetna EPO",
      callerPlan: "Aetna EPO",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Cigna"],
      status: "needs_clarification",
      clarificationNeeded: "which Cigna plan is on the card",
      callerPlan: "Cigna",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Fl Blue Select", "Florida Blue Select", "Blue Select"],
      status: "not_accepted",
      family: "Florida BlueSelect",
      callerPlan: "Florida BlueSelect",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Fl Blue Steward", "Florida Blue Steward"],
      status: "not_accepted",
      family: "Florida Blue Steward Tier 1",
      callerPlan: "Florida Blue Steward Tier 1",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Eye America"],
      status: "not_accepted",
      family: "Eye America AAO",
      callerPlan: "Eye America",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Av Med Medicare", "AvMed Medicare", "Av Med Medicare Advantage"],
      status: "not_accepted",
      family: "AvMed Medicare Advantage",
      callerPlan: "AvMed Medicare Advantage",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Miami Children's", "Miami Children's Health Plan", "Miami Children"],
      status: "not_accepted",
      family: "Miami Children's Health Plan",
      callerPlan: "Miami Children's Health Plan",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: [
        "Doctors Health",
        "Miami Dade Doctors Health",
        "Miami Dade Ddoctors Health",
        "Miami Dade Doctors Healthcare",
      ],
      status: "not_accepted",
      family: "Doctors Health Medicare",
      callerPlan: "Doctors Health Medicare",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Humana Gold Plus"],
      status: "not_accepted",
      family: "Humana Gold Plus",
      callerPlan: "Humana Gold Plus",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Humana Medicaid"],
      status: "not_accepted",
      family: "Humana Medicaid",
      callerPlan: "Humana Medicaid",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Cigna Local Plus"],
      status: "not_accepted",
      family: "Cigna Local Plus",
      callerPlan: "Cigna Local Plus",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Cigna Miami-Dade Public Schools"],
      status: "not_accepted",
      family: "Cigna Miami-Dade Public Schools",
      callerPlan: "Cigna Miami-Dade Public Schools",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Florida Blue HMO", "Fl Blue HMO"],
      status: "not_accepted",
      family: "Florida Blue HMO",
      callerPlan: "Florida Blue HMO",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Florida BlueSelect"],
      status: "not_accepted",
      family: "Florida BlueSelect",
      callerPlan: "Florida BlueSelect",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Florida Blue Steward Tier 1"],
      status: "not_accepted",
      family: "Florida Blue Steward Tier 1",
      callerPlan: "Florida Blue Steward Tier 1",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["AvMed Medicare Advantage"],
      status: "not_accepted",
      family: "AvMed Medicare Advantage",
      callerPlan: "AvMed Medicare Advantage",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Eye America AAO"],
      status: "not_accepted",
      family: "Eye America AAO",
      callerPlan: "Eye America",
      canProceed: false,
      needsExactPlanName: false,
    },
  ],
  acceptedPlans: [
    "Aetna",
    "Aetna Better Health",
    "Aetna Better Health of Florida",
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
    "Children's Medical Services",
    "Cigna HMO",
    "Cigna Medicare Advantage",
    "Cigna Open Access",
    "Cigna PPO",
    "Community Care Plan",
    "Envolve Vision",
    "Eye Care Health Solutions",
    "Florida Blue",
    "Florida Blue Medicare HMO",
    "Florida Blue Medicare PPO",
    "Florida Blue PPO Federal Employee",
    "Florida Blue PPO Out of State",
    "Florida Community Care",
    "Florida Complete Care",
    "Florida Medicaid",
    "Florida Medicare",
    "Humana Healthy Horizons",
    "Humana Medicare",
    "Humana PPO",
    "iCare",
    "Imagine Health",
    "Medicaid",
    "Meritain Health",
    "Molina Medicaid",
    "Molina Medicare",
    "Multiplan PHCS",
    "Oscar Health",
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
    "Aetna EPO",
    "Aetna EPO North Broward",
    "Aetna EPO University of Miami",
    "Humana Gold Plus",
    "Miami Children's Health Plan",
    "Humana Medicaid",
    "Florida BlueSelect",
    "Cigna Miami-Dade Public Schools",
    "Doctors Health Medicare",
    "AvMed Medicare Advantage",
    "Cigna Local Plus",
    "Eye America AAO",
    "Florida Blue HMO",
    "Florida Blue Steward Tier 1",
    "Molina Marketplace",
    "Preferred Care Partners",
  ],
} satisfies InsuranceRulesPayload;

const ABITA_CRYSTAL_RIVER_INSURANCE_RULES = {
  officeLabel: "Crystal River",
  aliasRules: [
    {
      aliases: ["Florida Blue HMO", "Fl Blue HMO"],
      status: "not_accepted",
      family: "Florida Blue HMO",
      callerPlan: "Florida Blue HMO",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Aetna Commercial", "Aetna PPO", "Aetna Managed Choice", "Aetna HMO"],
      status: "accepted",
      family: "Aetna",
      callerPlan: "Aetna Commercial",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Aetna Medicare", "Aetna Medicare PPO", "Aetna Medicare HMO"],
      status: "accepted",
      family: "Aetna Medicare",
      callerPlan: "Aetna Medicare",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: [
        "Florida Blue",
        "BCBS",
        "Blue Cross",
        "Blue Cross Blue Shield",
        "BCBS out of state",
        "Blue Cross out of state",
        "Blue Cross Blue Shield out of state",
      ],
      status: "accepted",
      family: "Florida Blue",
      callerPlan: "Blue Cross Blue Shield",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Medicare", "Standard Medicare"],
      status: "accepted",
      family: "Florida Medicare",
      callerPlan: "Medicare",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: [
        "United",
        "UHC",
        "United Healthcare",
        "UnitedHealthcare",
        "United Health Care",
      ],
      status: "accepted",
      family: "United Healthcare",
      callerPlan: "United Healthcare",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Cigna Medicare Advantage"],
      status: "accepted",
      family: "Cigna Medicare Advantage",
      callerPlan: "Cigna Medicare Advantage",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Cigna PPO"],
      status: "accepted",
      family: "Cigna PPO",
      callerPlan: "Cigna PPO",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Cigna Open Access"],
      status: "accepted",
      family: "Cigna Open Access",
      callerPlan: "Cigna Open Access",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Cigna HMO"],
      status: "accepted",
      family: "Cigna HMO",
      callerPlan: "Cigna HMO",
      canProceed: true,
      needsExactPlanName: true,
    },
    {
      aliases: ["Humana HMO", "Humana Care Plus", "Humana Premier HMO"],
      status: "not_accepted",
      family: "Humana HMO",
      callerPlan: "Humana HMO",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Humana"],
      status: "needs_clarification",
      clarificationNeeded: "which Humana plan is on the card",
      callerPlan: "Humana",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Cigna"],
      status: "needs_clarification",
      clarificationNeeded: "which Cigna plan is on the card",
      callerPlan: "Cigna",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Fl Blue Select", "Florida Blue Select", "Blue Select"],
      status: "not_accepted",
      family: "Florida BlueSelect",
      callerPlan: "Florida BlueSelect",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Fl Blue Steward", "Florida Blue Steward"],
      status: "not_accepted",
      family: "Florida Blue Steward Tier 1",
      callerPlan: "Florida Blue Steward Tier 1",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Eye America"],
      status: "not_accepted",
      family: "Eye America AAO",
      callerPlan: "Eye America",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Av Med Medicare", "AvMed Medicare", "Av Med Medicare Advantage"],
      status: "not_accepted",
      family: "AvMed Medicare Advantage",
      callerPlan: "AvMed Medicare Advantage",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Miami Children's", "Miami Children's Health Plan", "Miami Children"],
      status: "not_accepted",
      family: "Miami Children's Health Plan",
      callerPlan: "Miami Children's Health Plan",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: [
        "Doctors Health",
        "Miami Dade Doctors Health",
        "Miami Dade Ddoctors Health",
        "Miami Dade Doctors Healthcare",
      ],
      status: "not_accepted",
      family: "Doctors Health Medicare",
      callerPlan: "Doctors Health Medicare",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: [
        "All Medicaid Plans",
        "Medicaid",
        "Florida Medicaid",
        "Molina Medicaid",
        "Aetna Better Health",
        "Aetna Better Health of Florida",
        "Aetna Healthy Kids",
        "Community Care Plan",
        "Florida Community Care",
        "Florida Complete Care",
        "Humana Medicaid",
        "Humana Healthy Horizons",
        "Simply Medicaid",
        "Simply Health",
        "Vivida",
      ],
      status: "not_accepted",
      family: "Medicaid",
      callerPlan: "Medicaid",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Ambetter", "Ambetter Premier", "Ambetter Select", "Ambetter Value"],
      status: "not_accepted",
      family: "Ambetter",
      callerPlan: "Ambetter",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Staywell", "Staywell Medicare"],
      status: "not_accepted",
      family: "Staywell Medicare",
      callerPlan: "Staywell",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Sunshine", "Sunshine Health", "Sunshine Medicaid"],
      status: "not_accepted",
      family: "Sunshine Medicaid",
      callerPlan: "Sunshine",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Aetna EPO"],
      status: "not_accepted",
      family: "Aetna EPO",
      callerPlan: "Aetna EPO",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Humana Gold Plus"],
      status: "not_accepted",
      family: "Humana Gold Plus",
      callerPlan: "Humana Gold Plus",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Cigna Local Plus"],
      status: "not_accepted",
      family: "Cigna Local Plus",
      callerPlan: "Cigna Local Plus",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Cigna Miami-Dade Public Schools"],
      status: "not_accepted",
      family: "Cigna Miami-Dade Public Schools",
      callerPlan: "Cigna Miami-Dade Public Schools",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Florida BlueSelect"],
      status: "not_accepted",
      family: "Florida BlueSelect",
      callerPlan: "Florida BlueSelect",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Florida Blue Steward Tier 1"],
      status: "not_accepted",
      family: "Florida Blue Steward Tier 1",
      callerPlan: "Florida Blue Steward Tier 1",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["AvMed Medicare Advantage"],
      status: "not_accepted",
      family: "AvMed Medicare Advantage",
      callerPlan: "AvMed Medicare Advantage",
      canProceed: false,
      needsExactPlanName: false,
    },
    {
      aliases: ["Eye America AAO"],
      status: "not_accepted",
      family: "Eye America AAO",
      callerPlan: "Eye America",
      canProceed: false,
      needsExactPlanName: false,
    },
  ],
  acceptedPlans: [
    "Aetna Commercial",
    "Aetna PPO",
    "Aetna Managed Choice",
    "Aetna HMO",
    "Aetna Medicare",
    "Aetna Medicare PPO",
    "Aetna Medicare HMO",
    "Florida Blue",
    "Florida Blue PPO Out of State",
    "Florida Medicare",
    "United Healthcare",
    "Cigna HMO",
    "Cigna Medicare Advantage",
    "Cigna Open Access",
    "Cigna PPO",
  ],
  notAcceptedPlans: [
    "Blue Select",
    "Florida Blue BlueSelect",
    "Florida BlueSelect",
    "Florida Blue HMO",
    "Humana Care Plus",
    "Humana Gold Plus",
    "Humana Healthy Horizons",
    "Humana HMO",
    "Humana Medicaid",
    "Humana Medicare",
    "Humana PPO",
    "Humana Premier HMO",
    "Aetna EPO",
    "Aetna EPO North Broward",
    "Aetna EPO University of Miami",
    "Miami Children's Health Plan",
    "Cigna Miami-Dade Public Schools",
    "Doctors Health Medicare",
    "AvMed Medicare Advantage",
    "Cigna Local Plus",
    "Eye America AAO",
    "Florida Blue Steward Tier 1",
    "Aetna Better Health",
    "Aetna Better Health of Florida",
    "Aetna Healthy Kids",
    "Ambetter",
    "Ambetter Premier",
    "Ambetter Select",
    "Ambetter Value",
    "Community Care Plan",
    "Florida Community Care",
    "Florida Complete Care",
    "Florida Medicaid",
    "Medicaid",
    "Molina Medicaid",
    "Simply Medicaid",
    "Simply Health",
    "Staywell Medicare",
    "Sunshine Health",
    "Sunshine Medicaid",
    "Vivida",
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

function locationSlugSuffix(location: { id: string; name: string }, index: number) {
  return slugify(`${location.name}-${location.id || index + 1}`);
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
    const newOfficeRuleSets = practice.locations
      .map((location) => {
        const office = findAbitaNewOfficeByLocation(location);

        if (!office) {
          return null;
        }

        return {
          locationId: location.id,
          rules: cloneRules(ABITA_NEW_OFFICE_INSURANCE_RULES, office.name),
          slug: office.ruleSlug,
          title: office.insuranceTitle,
        };
      })
      .filter((ruleSet): ruleSet is NonNullable<typeof ruleSet> => Boolean(ruleSet));

    return [
      {
        locationId: springHillLocation?.id ?? null,
        rules: cloneRules(ABITA_INSURANCE_RULES, "Spring Hill"),
        slug: "spring-hill-insurance-rules",
        title: "Insurance Rules: Abita Eye Group, Spring Hill",
      },
      {
        locationId: crystalRiverLocation?.id ?? null,
        rules: cloneRules(ABITA_CRYSTAL_RIVER_INSURANCE_RULES, "Crystal River"),
        slug: "crystal-river-insurance-rules",
        title: "Insurance Rules: Eye Radiance, Crystal River",
      },
      ...newOfficeRuleSets,
    ];
  }

  const locations = practice.locations.length
    ? practice.locations
    : [{ address: null, id: "", isPrimary: true, name: practice.name }];

  return locations.map((location, index) => {
    const officeLabel = location.name || practice.name;

    return {
      locationId: location.id || null,
      rules: buildLegacyRules(practice, officeLabel),
      slug: slugify(
        `${officeLabel} ${locationSlugSuffix(location, index)} insurance rules`,
      ),
      title: `Insurance Rules: ${officeLabel}`,
    };
  });
}

async function loadInsuranceRuleSetsForPractice(
  practiceId: string,
  locationScopeWhere: ReturnType<typeof buildPortalLocationScopeWhere> = {},
) {
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
      ...locationScopeWhere,
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
      locationId: true,
      slug: true,
    },
    where: {
      practiceId,
      status: "ACTIVE",
    },
  });
  const existingSlugs = new Set(existingRuleSets.map((ruleSet) => ruleSet.slug));
  const existingLocationIds = new Set(
    existingRuleSets
      .map((ruleSet) => ruleSet.locationId)
      .filter((locationId): locationId is string => Boolean(locationId)),
  );

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

  const seedRuleSets = getSeedRuleSetsForPractice(practice).filter((ruleSet) => {
    if (existingSlugs.has(ruleSet.slug)) {
      return false;
    }
    return !ruleSet.locationId || !existingLocationIds.has(ruleSet.locationId);
  });

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
  const context = await getCurrentPortalPracticeContext();

  if (!context) {
    return null;
  }

  await ensureDefaultInsuranceRuleSets(context.practice.id);

  const ruleSets = (
    await loadInsuranceRuleSetsForPractice(
      context.practice.id,
      buildPortalLocationScopeWhere(context),
    )
  ).map(summarizeRuleSet);
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
  const context = await getCurrentPortalPracticeContext();

  if (!context) {
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
      practiceId: context.practice.id,
      status: "ACTIVE",
      ...buildPortalLocationScopeWhere(context),
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

  await prisma.$transaction(async (tx) => {
    const now = new Date();

    await tx.practiceInsuranceRuleRevision.updateMany({
      data: {
        reviewNote: "Superseded by a newer practice draft.",
        reviewedAt: now,
        status: "REJECTED",
      },
      where: {
        ruleSetId: ruleSet.id,
        status: "PENDING_APPROVAL",
      },
    });

    await tx.adminAlert.updateMany({
      data: {
        resolvedAt: now,
        status: "RESOLVED",
      },
      where: {
        insuranceRuleSetId: ruleSet.id,
        status: {
          in: ["UNREAD", "REVIEWING"],
        },
        type: "INSURANCE_RULES_EDITED",
      },
    });

    const revision = await tx.practiceInsuranceRuleRevision.create({
      data: {
        editedByUserId: context.session.user.id,
        ruleSetId: ruleSet.id,
        rules: jsonInput(parsed.rules),
        source: "PRACTICE",
        status: "PENDING_APPROVAL",
      },
    });

    await tx.adminAlert.create({
      data: {
        insuranceRuleRevisionId: revision.id,
        insuranceRuleSetId: ruleSet.id,
        message: `${ruleSet.practice.name} edited ${ruleSet.title}.`,
        practiceId: ruleSet.practiceId,
        type: "INSURANCE_RULES_EDITED",
      },
    });
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

    if (
      !alert?.insuranceRuleRevision ||
      !alert.insuranceRuleSet ||
      alert.type !== "INSURANCE_RULES_EDITED" ||
      !["UNREAD", "REVIEWING"].includes(alert.status) ||
      alert.insuranceRuleRevision.status !== "PENDING_APPROVAL"
    ) {
      return;
    }

    const now = new Date();

    const updatedRevision = await tx.practiceInsuranceRuleRevision.updateMany({
      data: {
        publishedAt: now,
        reviewedAt: now,
        reviewedByUserId: session.user.id,
        status: "PUBLISHED",
      },
      where: {
        id: alert.insuranceRuleRevision.id,
        status: "PENDING_APPROVAL",
      },
    });

    if (updatedRevision.count === 0) {
      return;
    }

    await tx.practiceInsuranceRuleRevision.updateMany({
      data: {
        reviewNote: "Superseded by a newer approved draft.",
        reviewedAt: now,
        reviewedByUserId: session.user.id,
        status: "REJECTED",
      },
      where: {
        id: {
          not: alert.insuranceRuleRevision.id,
        },
        ruleSetId: alert.insuranceRuleSet.id,
        status: "PENDING_APPROVAL",
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
        insuranceRuleSetId: alert.insuranceRuleSet.id,
        status: {
          in: ["UNREAD", "REVIEWING"],
        },
        type: "INSURANCE_RULES_EDITED",
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

    if (
      !alert?.insuranceRuleRevision ||
      alert.type !== "INSURANCE_RULES_EDITED" ||
      !["UNREAD", "REVIEWING"].includes(alert.status) ||
      alert.insuranceRuleRevision.status !== "PENDING_APPROVAL"
    ) {
      return;
    }

    const now = new Date();

    const updatedRevision = await tx.practiceInsuranceRuleRevision.updateMany({
      data: {
        reviewNote: reviewNote.trim() || null,
        reviewedAt: now,
        reviewedByUserId: session.user.id,
        status: "REJECTED",
      },
      where: {
        id: alert.insuranceRuleRevision.id,
        status: "PENDING_APPROVAL",
      },
    });

    if (updatedRevision.count === 0) {
      return;
    }

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
