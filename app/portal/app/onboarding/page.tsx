import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, CheckCircle2, ChevronRight, Globe2 } from "lucide-react";

import { Button } from "@/app/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import {
  getPortalWorkspaceState,
  type PortalWorkspaceState,
} from "@/lib/portal-state";

import { PortalInputField } from "../PortalFields";
import {
  launchPortalAction,
  savePracticeBasicsAction,
  saveProviderSetupAction,
  scanPracticeWebsiteAction,
} from "../actions";

type OnboardingStepKey =
  | "website"
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
      key: "website",
      label: "Website",
      complete: Boolean(portalState.draft.websiteUrl),
    },
    {
      key: "practiceProfile",
      label: "Basics",
      complete:
        portalState.sections.find(
          (section) => section.key === "practiceProfile",
        )?.complete === true,
    },
    {
      key: "providerRouting",
      label: "Providers",
      complete:
        portalState.sections.find(
          (section) => section.key === "providerRouting",
        )?.complete === true,
    },
    {
      key: "insuranceCrosswalk",
      label: "Insurance",
      complete:
        portalState.sections.find(
          (section) => section.key === "insuranceCrosswalk",
        )?.complete === true,
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
      label: "Launch",
      complete: portalState.launched,
    },
  ] as const satisfies readonly OnboardingStep[];
}

function getCurrentStep(steps: readonly OnboardingStep[]) {
  return steps.find((step) => !step.complete)?.key ?? "review";
}

function isOnboardingStepKey(
  value: string | undefined,
): value is OnboardingStepKey {
  return [
    "website",
    "practiceProfile",
    "providerRouting",
    "insuranceCrosswalk",
    "knowledgeBase",
    "review",
  ].includes(value || "");
}

async function readRequestedStep(searchParams: SearchParamsInput) {
  const resolved = (await searchParams) || {};
  const rawStep = Array.isArray(resolved.step)
    ? resolved.step[0]
    : resolved.step;

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

  if (requestedStep === "website") {
    return requestedStep;
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

function RescanWebsiteButton() {
  return (
    <Button asChild size="sm" variant="secondary">
      <Link href={getStepHref("website")}>Edit or rescan website</Link>
    </Button>
  );
}

export default async function PortalOnboardingPage({
  searchParams,
}: Readonly<{
  searchParams?: SearchParamsInput;
}>) {
  const portalState = await getPortalWorkspaceState();

  if (portalState.launched) {
    redirect("/portal/app/overview");
  }

  const steps = getOnboardingSteps(portalState);
  const currentStep = getCurrentStep(steps);
  const requestedStep = await readRequestedStep(searchParams);
  const visibleStep = getVisibleStep(requestedStep, currentStep, steps);
  const currentIndex = steps.findIndex((step) => step.key === currentStep);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#6a7b7e]">
          Onboarding Wizard
        </p>
        <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
          Complete practice setup
        </h2>
        <p className="max-w-2xl text-base leading-relaxed text-[#617477]">
          One step at a time. Start with the website, then confirm the
          structured setup before launch.
        </p>
      </section>

      <div className="grid gap-2 md:grid-cols-6">
        {steps.map((step, index) => {
          const stepIndex = steps.findIndex(
            (candidate) => candidate.key === step.key,
          );
          const isClickable =
            step.key === "website" || stepIndex <= currentIndex;

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

      {visibleStep === "website" ? (
        <Card className="rounded-[1.8rem] border-black/6 bg-white">
          <CardHeader>
            <CardTitle>
              {portalState.draft.websiteUrl
                ? "Edit or rescan website"
                : "Practice website"}
            </CardTitle>
            <CardDescription>
              {portalState.draft.websiteUrl
                ? "Update the URL and rescan anytime during onboarding."
                : "Paste the website to create a starting draft."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <form action={scanPracticeWebsiteAction} className="space-y-4">
              <PortalInputField
                defaultValue={portalState.draft.websiteUrl}
                label="Website URL"
                name="websiteUrl"
                placeholder="https://yourpractice.com"
                type="url"
              />
              <Button type="submit" variant="primary">
                <Globe2 className="h-4 w-4" aria-hidden="true" />
                {portalState.draft.websiteUrl
                  ? "Rescan website"
                  : "Scan website"}
              </Button>
            </form>

            <div className="rounded-[1.4rem] border border-dashed border-black/10 bg-[#f7fbfa] px-4 py-4 text-sm text-[#617477]">
              Rescanning refreshes the imported basics and sends you back to
              review them.
            </div>
          </CardContent>
        </Card>
      ) : null}

      {visibleStep === "practiceProfile" ? (
        <Card className="rounded-[1.8rem] border-black/6 bg-white">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Review practice basics</CardTitle>
                <CardDescription>
                  Confirm the imported office details.
                </CardDescription>
              </div>
              <RescanWebsiteButton />
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="inline-flex rounded-full border border-[#d7ebe8] bg-[#edf8f6] px-3 py-1 text-xs font-medium text-[#0d7377]">
              Imported from {portalState.draft.websiteUrl}
            </div>

            <form
              action={savePracticeBasicsAction}
              className="grid gap-4 md:grid-cols-2"
            >
              <PortalInputField
                defaultValue={portalState.draft.practiceName}
                label="Practice name"
                name="practiceName"
                placeholder="North Miami Beach Eye Center"
              />
              <PortalInputField
                defaultValue={portalState.draft.locationName}
                label="Primary location"
                name="locationName"
                placeholder="North Miami Beach"
              />
              <PortalInputField
                defaultValue={portalState.draft.phone}
                label="Phone"
                name="phone"
                placeholder="(305) 555-0184"
                type="tel"
              />
              <PortalInputField
                defaultValue={portalState.draft.fax}
                label="Fax"
                name="fax"
                placeholder="(305) 555-0110"
                type="tel"
              />
              <div className="md:col-span-2">
                <PortalInputField
                  defaultValue={portalState.draft.address}
                  label="Address"
                  name="address"
                  placeholder="123 Main St, Suite 200"
                />
              </div>
              <div className="md:col-span-2">
                <Button type="submit" variant="primary">
                  Save and continue
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </form>
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
                  Add the first provider record in structured form.
                </CardDescription>
              </div>
              <RescanWebsiteButton />
            </div>
          </CardHeader>
          <CardContent>
            <form
              action={saveProviderSetupAction}
              className="grid gap-4 md:grid-cols-2"
            >
              <PortalInputField
                defaultValue={portalState.draft.providerName}
                label="Provider name"
                name="providerName"
                placeholder="Dr. Jane Doe"
              />
              <PortalInputField
                defaultValue={portalState.draft.providerSpecialty}
                label="Specialty"
                name="providerSpecialty"
                placeholder="Comprehensive ophthalmology"
              />
              <PortalInputField
                defaultValue={portalState.draft.providerNpi}
                label="NPI"
                name="providerNpi"
                placeholder="1234567890"
              />
              <PortalInputField
                defaultValue={portalState.draft.providerLocation}
                label="Primary location"
                name="providerLocation"
                placeholder={portalState.draft.locationName || "Main office"}
              />
              <PortalInputField
                defaultValue={portalState.draft.providerHours}
                label="Hours"
                name="providerHours"
                placeholder="Mon-Thu 8a-5p, Fri 8a-1p"
              />
              <PortalInputField
                defaultValue={portalState.draft.providerSchedulingNotes}
                label="Scheduling notes"
                name="providerSchedulingNotes"
                placeholder="New patients need referral on file"
              />
              <div className="md:col-span-2">
                <Button type="submit" variant="primary">
                  Save and continue
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {visibleStep === "insuranceCrosswalk" ? (
        <Card className="rounded-[1.8rem] border-black/6 bg-white">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Insurance crosswalk</CardTitle>
                <CardDescription>
                  Finish the insurance rules next.
                </CardDescription>
              </div>
              <RescanWebsiteButton />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-[#617477]">
              Accepted plans, exceptions, and staff handoff rules.
            </div>
            <Button asChild variant="primary">
              <Link href="/portal/app/insurance-crosswalk">
                Open insurance step
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
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
                  Then capture the answers and scripts the agent uses.
                </CardDescription>
              </div>
              <RescanWebsiteButton />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-[#617477]">
              FAQs, appointment prep, office policies, and after-hours rules.
            </div>
            <Button asChild variant="primary">
              <Link href="/portal/app/knowledge-base">
                Open knowledge step
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {visibleStep === "review" ? (
        <Card className="rounded-[1.8rem] border-black/6 bg-white">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Review and launch</CardTitle>
                <CardDescription>
                  Only the missing items show up here.
                </CardDescription>
              </div>
              <RescanWebsiteButton />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {portalState.missingSections.length ? (
              portalState.missingSections.map((section) => (
                <div
                  key={section.key}
                  className="rounded-[1.4rem] border border-[#f0dfcc] bg-[#fff8f1] px-4 py-4 text-sm text-[#7a5a27]"
                >
                  {section.label} still needs review.
                </div>
              ))
            ) : (
              <div className="rounded-[1.4rem] border border-[#d7ebe8] bg-[#edf8f6] px-4 py-4 text-sm text-[#0d7377]">
                Everything required for launch is complete.
              </div>
            )}

            <form action={launchPortalAction}>
              <Button type="submit" variant="primary">
                Launch agent
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
