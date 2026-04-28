import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/app/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import {
  DocumentPageHeader,
  DocumentPanel,
  DocumentSection,
  DocumentText,
} from "@/app/portal/app/DocumentView";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import { PortalTextareaField } from "../PortalFields";
import { saveKnowledgeBaseAction } from "../actions";
import LocationRuleScopeFields from "../onboarding/LocationRuleScopeFields";

type SearchParamsInput =
  | Promise<Record<string, string | string[] | undefined>>
  | undefined;

async function isEditMode(searchParams: SearchParamsInput) {
  const resolved = (await searchParams) || {};
  const rawMode = Array.isArray(resolved.mode) ? resolved.mode[0] : resolved.mode;

  return rawMode === "edit";
}

export default async function PortalKnowledgeBasePage({
  searchParams,
}: Readonly<{
  searchParams?: SearchParamsInput;
}>) {
  const portalState = await getPortalWorkspaceState();
  const editing = await isEditMode(searchParams);
  const knowledgeUsesLocationRules = portalState.draft.locations.some(
    (location) => location.knowledgeVaries || location.knowledgeNotes,
  );
  const isReviewed = portalState.sections.find(
    (section) => section.key === "knowledgeBase",
  )?.complete;
  const shouldShowDocument = portalState.launched && !editing;
  const primaryLabel = portalState.launched ? "Save changes" : "Save and continue";
  const returnHref = portalState.launched
    ? "/portal/app/knowledge-base"
    : "/portal/app/onboarding";
  const returnLabel = portalState.launched ? "Back to document" : "Back to onboarding";

  if (shouldShowDocument) {
    const locationRules = portalState.draft.locations.filter(
      (location) => location.knowledgeVaries || location.knowledgeNotes,
    );

    return (
      <div className="space-y-6">
        <DocumentPageHeader
          actionHref="/portal/app/knowledge-base?mode=edit"
          description="A structured playbook for what the AI receptionist should say, avoid, and hand off to staff."
          eyebrow="Documents"
          title="Knowledge base"
        />

        <DocumentPanel>
          <DocumentSection
            description="High-frequency patient questions and approved answers."
            title="Common questions"
          >
            <DocumentText value={portalState.draft.knowledgeCommonQuestions} />
          </DocumentSection>

          <DocumentSection
            description="What callers should know before an appointment."
            title="Appointment prep"
          >
            <DocumentText value={portalState.draft.knowledgeAppointmentPrep} />
          </DocumentSection>

          <DocumentSection
            description="Office rules the receptionist can repeat."
            title="Office policies"
          >
            <DocumentText value={portalState.draft.knowledgeOfficePolicies} />
          </DocumentSection>

          <DocumentSection
            description="How to handle urgent or after-hours conversations."
            title="After-hours rules"
          >
            <DocumentText value={portalState.draft.knowledgeAfterHours} />
          </DocumentSection>

          <DocumentSection
            description="Escalation criteria for a human handoff."
            title="Transfer to staff when"
          >
            <DocumentText value={portalState.draft.insuranceTransferRules} />
          </DocumentSection>

          <DocumentSection
            description="Approved phrasing guardrails."
            title="Always say / never say"
          >
            <DocumentText value={portalState.draft.knowledgePhrases} />
          </DocumentSection>

          <DocumentSection
            description="Location-specific scripts, policies, or routing notes."
            title="Location notes"
          >
            {locationRules.length ? (
              <div className="space-y-3">
                {locationRules.map((location, index) => (
                  <div
                    key={location.id || `${location.locationName}-${index}`}
                    className="rounded-2xl border border-black/6 bg-[#f7fbfa] px-4 py-4"
                  >
                    <p className="text-sm font-semibold text-[#10272c]">
                      {location.locationName || `Location ${index + 1}`}
                    </p>
                    <div className="mt-2">
                      <DocumentText value={location.knowledgeNotes} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <DocumentText
                value=""
                empty="Same knowledge and scripts for all locations."
              />
            )}
          </DocumentSection>
        </DocumentPanel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#6a7b7e]">
          Knowledge Base
        </p>
        <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
          {portalState.launched ? "Edit knowledge base" : "Practice knowledge"}
        </h2>
        <p className="max-w-2xl text-base leading-relaxed text-[#617477]">
          Keep this short and structured. Add what the practice wants said, skipped, or
          escalated.
        </p>
      </section>

      <Card className="rounded-[1.8rem] border-black/6 bg-white">
        <CardHeader>
          <CardTitle>{isReviewed ? "Knowledge saved" : "Finish this step"}</CardTitle>
          <CardDescription>
            FAQs, prep, policies, after-hours, escalation rules, and required phrases.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveKnowledgeBaseAction} className="grid gap-4">
            <PortalTextareaField
              defaultValue={portalState.draft.knowledgeCommonQuestions}
              label="Common questions"
              name="knowledgeCommonQuestions"
              placeholder="Do you take walk-ins? How do I send a referral?"
              rows={3}
            />
            <PortalTextareaField
              defaultValue={portalState.draft.knowledgeAppointmentPrep}
              label="Appointment prep"
              name="knowledgeAppointmentPrep"
              placeholder="Dilated exam patients should bring sunglasses and arrive 15 minutes early."
              rows={3}
            />
            <PortalTextareaField
              defaultValue={portalState.draft.knowledgeOfficePolicies}
              label="Office policies"
              name="knowledgeOfficePolicies"
              placeholder="Late arrivals over 15 minutes may need rescheduling."
              rows={3}
            />
            <PortalTextareaField
              defaultValue={portalState.draft.knowledgeAfterHours}
              label="After-hours rules"
              name="knowledgeAfterHours"
              placeholder="Urgent flashes, floaters, or vision loss should be transferred immediately."
              rows={3}
            />
            <PortalTextareaField
              defaultValue={portalState.draft.insuranceTransferRules}
              label="Transfer to staff when"
              name="insuranceTransferRules"
              placeholder="A caller is upset, symptoms sound urgent, coverage is unclear, or the request falls outside approved scripts."
              rows={3}
            />
            <PortalTextareaField
              defaultValue={portalState.draft.knowledgePhrases}
              label="Always say / never say"
              name="knowledgePhrases"
              placeholder="Always confirm callback timing. Never promise same-day availability."
              rows={3}
            />
            <LocationRuleScopeFields
              byLocationLabel="Knowledge or scripts differ by location"
              defaultByLocation={knowledgeUsesLocationRules}
              locationNotesKey="knowledgeNotes"
              locations={portalState.draft.locations}
              placeholder="Location-specific hours, policies, scripts, prep, parking, routing, or escalation notes."
              scopeName="knowledgeRulesScope"
              sectionTitle="Knowledge scope"
              sharedLabel="Same knowledge and scripts for all locations"
              variesKey="knowledgeVaries"
            />

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" variant="primary">
                {primaryLabel}
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              {isReviewed ? (
                <Button asChild variant="secondary">
                  <Link href={returnHref}>{returnLabel}</Link>
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
