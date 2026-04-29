import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock3 } from "lucide-react";

import { InsuranceRulesView } from "@/app/components/InsuranceRulesView";
import { Button } from "@/app/components/ui/button";
import { DocumentPanel } from "@/app/portal/app/DocumentView";
import { PracticePageHeader } from "@/app/portal/app/PracticePageHeader";
import { getPortalInsuranceRuleState } from "@/lib/insurance-rules";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { cn } from "@/lib/utils";

import { InsuranceRulesEditor } from "./InsuranceRulesEditor";

type SearchParamsInput =
  | Promise<Record<string, string | string[] | undefined>>
  | undefined;

async function getPageParams(searchParams: SearchParamsInput) {
  const resolved = (await searchParams) || {};
  const rawMode = Array.isArray(resolved.mode) ? resolved.mode[0] : resolved.mode;
  const rawRules = Array.isArray(resolved.rules) ? resolved.rules[0] : resolved.rules;

  return {
    editing: rawMode === "edit",
    invalid: resolved.invalid === "1",
    selectedSlug: typeof rawRules === "string" ? rawRules : undefined,
    submitted: resolved.submitted === "1",
    unchanged: resolved.unchanged === "1",
  };
}

function formatDate(date: Date | null) {
  if (!date) {
    return "Not published yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
    year: "numeric",
  }).format(date);
}

function ruleSetLabel(ruleSet: {
  locationName: string | null;
  slug: string;
  title: string;
}) {
  if (ruleSet.locationName) {
    return ruleSet.locationName;
  }
  if (ruleSet.slug.includes("crystal")) {
    return "Crystal River";
  }
  if (ruleSet.slug.includes("spring")) {
    return "Spring Hill";
  }
  return ruleSet.title.replace(/^Insurance Rules:\s*/i, "");
}

function InsuranceRuleSetSelector({
  ruleSets,
  selectedId,
}: {
  ruleSets: Array<{
    id: string;
    locationName: string | null;
    slug: string;
    title: string;
  }>;
  selectedId: string;
}) {
  if (ruleSets.length <= 1) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#748588]">
        Location
      </p>
      <nav aria-label="Insurance rules location" className="flex gap-2 overflow-x-auto">
        {ruleSets.map((ruleSet) => (
          <Link
            key={ruleSet.id}
            className={cn(
              "min-w-fit rounded-lg border px-3 py-2 text-sm font-medium transition",
              ruleSet.id === selectedId
                ? "border-[#0d7377] bg-[#e8f4f4] text-[#0d7377]"
                : "border-black/8 bg-white text-[#617477] hover:text-[#10272c]",
            )}
            href={`/portal/app/insurance-crosswalk?rules=${encodeURIComponent(
              ruleSet.slug,
            )}`}
          >
            {ruleSetLabel(ruleSet)}
          </Link>
        ))}
      </nav>
    </section>
  );
}

export default async function PortalInsuranceRulesPage({
  searchParams,
}: Readonly<{
  searchParams?: SearchParamsInput;
}>) {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding?step=insuranceCrosswalk");
  }

  const { editing, invalid, selectedSlug, submitted, unchanged } =
    await getPageParams(searchParams);
  const insuranceRuleState = await getPortalInsuranceRuleState(selectedSlug);

  if (!insuranceRuleState) {
    redirect("/portal");
  }

  const selectedRuleSet = insuranceRuleState.selectedRuleSet;
  const practiceName = portalState.draft.practiceName || "Practice";

  if (!selectedRuleSet?.publishedRevision) {
    return (
      <div className="space-y-6">
        <PracticePageHeader
          branding={portalState.branding}
          practiceName={practiceName}
          title="Insurance Rules"
        />
        <DocumentPanel>
          <div className="px-5 py-10 text-sm text-[#617477] md:px-7">
            No insurance rules have been created yet.
          </div>
        </DocumentPanel>
      </div>
    );
  }

  const editHref = `/portal/app/insurance-crosswalk?rules=${encodeURIComponent(
    selectedRuleSet.slug,
  )}&mode=edit`;
  const viewHref = `/portal/app/insurance-crosswalk?rules=${encodeURIComponent(
    selectedRuleSet.slug,
  )}`;
  const pendingRevision = selectedRuleSet.pendingRevision;
  const currentRulesJson =
    pendingRevision?.rulesJson ?? selectedRuleSet.publishedRevision.rulesJson;

  if (editing) {
    return (
      <div className="space-y-6">
        <PracticePageHeader
          branding={portalState.branding}
          practiceName={practiceName}
          title="Insurance Rules"
        >
          <Button asChild variant="secondary">
            <Link href={viewHref}>Back to rules</Link>
          </Button>
        </PracticePageHeader>

        <InsuranceRuleSetSelector
          ruleSets={insuranceRuleState.ruleSets}
          selectedId={selectedRuleSet.id}
        />

        {invalid ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            The submitted JSON could not be saved. Review the structure and try again.
          </div>
        ) : null}

        {pendingRevision ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This location already has a draft waiting for admin review. Saving again
            creates a newer pending draft.
          </div>
        ) : null}

        <InsuranceRulesEditor
          defaultRulesJson={currentRulesJson}
          ruleSetId={selectedRuleSet.id}
          viewHref={viewHref}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PracticePageHeader
        branding={portalState.branding}
        practiceName={practiceName}
        title="Insurance Rules"
      >
        <Button asChild variant="secondary">
          <Link href={editHref}>Edit JSON</Link>
        </Button>
      </PracticePageHeader>

      <InsuranceRuleSetSelector
        ruleSets={insuranceRuleState.ruleSets}
        selectedId={selectedRuleSet.id}
      />

      {submitted ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Draft saved. Acuity admin will review it before publishing.
        </div>
      ) : null}

      {unchanged ? (
        <div className="rounded-lg border border-black/8 bg-white px-4 py-3 text-sm text-[#617477]">
          No changes were submitted.
        </div>
      ) : null}

      {pendingRevision ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Draft waiting for admin review</p>
            <p className="mt-1">
              The published rules below stay live until Acuity admin approves the pending
              draft from {formatDate(pendingRevision.createdAt)}.
            </p>
          </div>
        </div>
      ) : null}

      <DocumentPanel>
        <div className="border-b border-black/6 px-5 py-4 text-xs font-medium uppercase tracking-[0.16em] text-[#7f9093] md:px-7">
          Published {formatDate(selectedRuleSet.publishedRevision.publishedAt)}
        </div>
        <div className="px-5 py-6 md:px-7">
          <InsuranceRulesView rules={selectedRuleSet.publishedRevision.rules} />
        </div>
      </DocumentPanel>
    </div>
  );
}
