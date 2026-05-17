import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowUpRight, CheckCircle2, ChevronRight } from "lucide-react";

import { Button } from "@/app/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { getCurrentPortalPracticeContext } from "@/lib/portal-access";
import { getPortalWorkspaceState, type PortalWorkspaceState } from "@/lib/portal-state";

import { PortalTextareaField } from "../PortalFields";
import {
  saveInsuranceCrosswalkAction,
  saveKnowledgeBaseAction,
  submitOnboardingAction,
} from "../actions";
import LocationSetupForm from "./LocationSetupForm";
import LocationRuleScopeFields from "./LocationRuleScopeFields";
import ProviderSetupForm from "./ProviderSetupForm";

type OnboardingStepKey =
  | "practiceProfile"
  | "providerRouting"
  | "insuranceCrosswalk"
  | "knowledgeBase"
  | "review";

type OnboardingStep = {
  complete: boolean;
  key: OnboardingStepKey;
  label: string;
};

type SearchParamsInput =
  | Promise<Record<string, string | string[] | undefined>>
  | undefined;

function getOnboardingSteps(portalState: PortalWorkspaceState) {
  return [
    {
      key: "practiceProfile",
      label: "Basics",
      complete:
        portalState.sections.find((section) => section.key === "practiceProfile")
          ?.complete === true,
    },
    {
      key: "providerRouting",
      label: "Providers",
      complete:
        portalState.sections.find((section) => section.key === "providerRouting")
          ?.complete === true,
    },
    {
      key: "insuranceCrosswalk",
      label: "Insurance",
      complete:
        portalState.sections.find((section) => section.key === "insuranceCrosswalk")
          ?.complete === true,
    },
    {
      key: "knowledgeBase",
      label: "Knowledge",
      complete:
        portalState.sections.find((section) => section.key === "knowledgeBase")
          ?.complete === true,
    },
    {
      key: "review",
      label: "Review",
      complete: portalState.launched,
    },
  ] as const satisfies readonly OnboardingStep[];
}

function getCurrentStep(steps: readonly OnboardingStep[]) {
  return steps.find((step) => !step.complete)?.key ?? "review";
}

function isOnboardingStepKey(value: string | undefined): value is OnboardingStepKey {
  return [
    "practiceProfile",
    "providerRouting",
    "insuranceCrosswalk",
    "knowledgeBase",
    "review",
  ].includes(value || "");
}

async function readRequestedStep(searchParams: SearchParamsInput) {
  const resolved = (await searchParams) || {};
  const rawStep = Array.isArray(resolved.step) ? resolved.step[0] : resolved.step;

  return isOnboardingStepKey(rawStep) ? rawStep : undefined;
}

function getVisibleStep(
  requestedStep: OnboardingStepKey | undefined,
  currentStep: OnboardingStepKey,
  steps: readonly OnboardingStep[],
) {
  if (!requestedStep) {
    return currentStep;
  }

  const currentIndex = steps.findIndex((step) => step.key === currentStep);
  const requestedIndex = steps.findIndex((step) => step.key === requestedStep);

  if (requestedIndex === -1) {
    return currentStep;
  }

  return requestedIndex <= currentIndex ? requestedStep : currentStep;
}

function getStepHref(step: OnboardingStepKey) {
  return `/portal/app/onboarding?step=${step}`;
}

function getPreviousStep(
  steps: readonly OnboardingStep[],
  visibleStep: OnboardingStepKey,
) {
  const visibleIndex = steps.findIndex((step) => step.key === visibleStep);

  return visibleIndex > 0 ? steps[visibleIndex - 1] : null;
}

function StepCard({
  index,
  isActive,
  isClickable,
  step,
}: Readonly<{
  index: number;
  isActive: boolean;
  isClickable: boolean;
  step: OnboardingStep;
}>) {
  const content = (
    <div
      className={`rounded-[1.4rem] border px-4 py-3 ${
        step.complete
          ? "border-[#d7ebe8] bg-[#edf8f6]"
          : isActive
            ? "border-[#8bcac2] bg-white"
            : "border-black/6 bg-white/70"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            step.complete
              ? "bg-[#dff2ee] text-[#0d7377]"
              : isActive
                ? "bg-[#0d7377] text-white"
                : "bg-[#eef4f3] text-[#6a7b7e]"
          }`}
        >
          {step.complete ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            index + 1
          )}
        </div>
        <p className="text-sm font-semibold text-[#10272c]">{step.label}</p>
      </div>
    </div>
  );

  if (!isClickable) {
    return content;
  }

  return (
    <Link className="block" href={getStepHref(step.key)}>
      {content}
    </Link>
  );
}

function WizardBackButton({
  previousStep,
}: Readonly<{
  previousStep: OnboardingStep | null;
}>) {
  if (!previousStep) {
    return null;
  }

  return (
    <Button asChild size="sm" variant="secondary">
      <Link href={getStepHref(previousStep.key)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </Link>
    </Button>
  );
}

export default async function PortalOnboardingPage({
  searchParams,
}: Readonly<{
  searchParams?: SearchParamsInput;
}>) {
  const accessContext = await getCurrentPortalPracticeContext();
  const portalState = await getPortalWorkspaceState();

  if (accessContext && !accessContext.hasAllLocationAccess) {
    if (portalState.launched) {
      redirect("/portal/app/overview");
    }

    return (
      <div className="mx-auto max-w-2xl">
        <Card className="rounded-[1.8rem] border-black/6 bg-white">
          <CardHeader>
            <CardTitle>Portal access is not live yet</CardTitle>
            <CardDescription>
              This scoped login will be available after the practice setup is launched.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (portalState.launched) {
    redirect("/portal/app/overview");
  }

  const steps = getOnboardingSteps(portalState);
  const currentStep = getCurrentStep(steps);
  const requestedStep = await readRequestedStep(searchParams);
  const visibleStep = getVisibleStep(requestedStep, currentStep, steps);
  const currentIndex = steps.findIndex((step) => step.key === currentStep);
  const previousStep = getPreviousStep(steps, visibleStep);
  const locationNames = portalState.draft.locations
    .map((location) => location.locationName)
    .filter(Boolean);
  const insuranceUsesLocationRules = portalState.draft.locations.some(
    (location) => location.insuranceVaries || location.insuranceNotes,
  );
  const knowledgeUsesLocationRules = portalState.draft.locations.some(
    (location) => location.knowledgeVaries || location.knowledgeNotes,
  );

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#6a7b7e]">
          Onboarding Wizard
        </p>
        <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
          Complete practice setup
        </h2>
      </section>

      <div className="grid gap-2 md:grid-cols-5">
        {steps.map((step, index) => {
          const stepIndex = steps.findIndex((candidate) => candidate.key === step.key);
          const isClickable = stepIndex <= currentIndex;

          return (
            <StepCard
              key={step.key}
              index={index}
              isActive={step.key === visibleStep}
              isClickable={isClickable}
              step={step}
            />
          );
        })}
      </div>

      {visibleStep === "practiceProfile" ? (
        <Card className="rounded-[1.8rem] border-black/6 bg-white">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Practice basics and locations</CardTitle>
              </div>
              <WizardBackButton previousStep={previousStep} />
            </div>
          </CardHeader>
          <CardContent>
            <LocationSetupForm
              initialLocations={portalState.draft.locations}
              practiceName={portalState.draft.practiceName}
            />
          </CardContent>
        </Card>
      ) : null}

      {visibleStep === "providerRouting" ? (
        <Card className="rounded-[1.8rem] border-black/6 bg-white">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Providers and locations</CardTitle>
                <CardDescription>
                  Add every provider staff may route or schedule for.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ProviderSetupForm
              backHref={getStepHref("practiceProfile")}
              initialProviders={portalState.draft.providers}
              locationNames={locationNames}
            />
          </CardContent>
        </Card>
      ) : null}

      {visibleStep === "insuranceCrosswalk" ? (
        <Card className="rounded-[1.8rem] border-black/6 bg-white">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Insurance rules</CardTitle>
                <CardDescription>
                  Capture accepted plans, exceptions, and staff handoff rules.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form action={saveInsuranceCrosswalkAction} className="grid gap-4">
              <PortalTextareaField
                defaultValue={portalState.draft.insuranceAcceptedPlans}
                label="Accepted plans"
                name="insuranceAcceptedPlans"
                placeholder="Aetna, Blue Cross Blue Shield, Medicare, VSP"
                rows={3}
              />
              <PortalTextareaField
                defaultValue={portalState.draft.insuranceExceptions}
                label="Exceptions"
                name="insuranceExceptions"
                placeholder="No Medicaid at surgery center. Vision plans only at main office."
                rows={3}
              />
              <LocationRuleScopeFields
                byLocationLabel="Insurance rules differ by location"
                defaultByLocation={insuranceUsesLocationRules}
                locationNotesKey="insuranceNotes"
                locations={portalState.draft.locations}
                placeholder="Plans, exceptions, authorizations, or coverage notes that only apply to this location."
                scopeName="insuranceRulesScope"
                sectionTitle="Insurance rule scope"
                sharedLabel="Same insurance rules for all locations"
                variesKey="insuranceVaries"
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button asChild variant="secondary">
                  <Link href={getStepHref("providerRouting")}>
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Back
                  </Link>
                </Button>
                <Button type="submit" variant="primary">
                  Save and continue
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {visibleStep === "knowledgeBase" ? (
        <Card className="rounded-[1.8rem] border-black/6 bg-white">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Practice knowledge</CardTitle>
                <CardDescription>
                  Capture the answers, scripts, and handoff rules.
                </CardDescription>
              </div>
            </div>
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

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button asChild variant="secondary">
                  <Link href={getStepHref("insuranceCrosswalk")}>
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Back
                  </Link>
                </Button>
                <Button type="submit" variant="primary">
                  Save and continue
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {visibleStep === "review" ? (
        <Card className="rounded-[1.8rem] border-black/6 bg-white">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Review info</CardTitle>
                <CardDescription>
                  You can edit the knowledge base and insurance rules after submitting.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[1.4rem] border border-black/6 bg-[#f7fbfa] px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#10272c]">Practice basics</p>
                  <Link
                    className="text-sm font-medium text-[#0d7377]"
                    href={getStepHref("practiceProfile")}
                  >
                    Edit
                  </Link>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[#617477]">
                  {portalState.draft.practiceName || "Practice name missing"}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-[#617477]">
                  {portalState.draft.locations.length
                    ? `${portalState.draft.locations.length} location${
                        portalState.draft.locations.length === 1 ? "" : "s"
                      } added`
                    : "No locations added"}
                </p>
              </div>

              <div className="rounded-[1.4rem] border border-black/6 bg-[#f7fbfa] px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#10272c]">Providers</p>
                  <Link
                    className="text-sm font-medium text-[#0d7377]"
                    href={getStepHref("providerRouting")}
                  >
                    Edit
                  </Link>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[#617477]">
                  {portalState.draft.providers.length
                    ? `${portalState.draft.providers.length} provider${
                        portalState.draft.providers.length === 1 ? "" : "s"
                      } added`
                    : "No providers added"}
                </p>
              </div>

              <div className="rounded-[1.4rem] border border-black/6 bg-[#f7fbfa] px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#10272c]">Insurance</p>
                  <Link
                    className="text-sm font-medium text-[#0d7377]"
                    href={getStepHref("insuranceCrosswalk")}
                  >
                    Edit
                  </Link>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[#617477]">
                  {portalState.draft.insuranceAcceptedPlans ||
                  portalState.draft.insuranceExceptions ||
                  insuranceUsesLocationRules
                    ? "Insurance guidance captured"
                    : "Insurance guidance missing"}
                  {insuranceUsesLocationRules
                    ? ` (${portalState.draft.locations.length} location override${
                        portalState.draft.locations.length === 1 ? "" : "s"
                      })`
                    : ""}
                </p>
              </div>

              <div className="rounded-[1.4rem] border border-black/6 bg-[#f7fbfa] px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#10272c]">Knowledge</p>
                  <Link
                    className="text-sm font-medium text-[#0d7377]"
                    href={getStepHref("knowledgeBase")}
                  >
                    Edit
                  </Link>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[#617477]">
                  {portalState.draft.knowledgeCommonQuestions ||
                  portalState.draft.knowledgeAppointmentPrep ||
                  portalState.draft.knowledgeOfficePolicies ||
                  portalState.draft.knowledgeAfterHours ||
                  portalState.draft.insuranceTransferRules ||
                  portalState.draft.knowledgePhrases ||
                  knowledgeUsesLocationRules
                    ? "Practice knowledge captured"
                    : "Practice knowledge missing"}
                  {knowledgeUsesLocationRules
                    ? ` (${portalState.draft.locations.length} location override${
                        portalState.draft.locations.length === 1 ? "" : "s"
                      })`
                    : ""}
                </p>
              </div>
            </div>

            {portalState.missingSections.length
              ? portalState.missingSections.map((section) => (
                  <div
                    key={section.key}
                    className="rounded-[1.4rem] border border-[#f0dfcc] bg-[#fff8f1] px-4 py-4 text-sm text-[#7a5a27]"
                  >
                    {section.label} still needs review.
                  </div>
                ))
              : null}

            <form action={submitOnboardingAction}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button asChild variant="secondary">
                  <Link href={getStepHref("knowledgeBase")}>
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Back
                  </Link>
                </Button>
                <Button type="submit" variant="primary">
                  Submit setup
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
