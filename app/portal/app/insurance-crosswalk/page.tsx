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
import { saveInsuranceCrosswalkAction } from "../actions";
import LocationRuleScopeFields from "../onboarding/LocationRuleScopeFields";

type SearchParamsInput =
  | Promise<Record<string, string | string[] | undefined>>
  | undefined;

async function isEditMode(searchParams: SearchParamsInput) {
  const resolved = (await searchParams) || {};
  const rawMode = Array.isArray(resolved.mode) ? resolved.mode[0] : resolved.mode;

  return rawMode === "edit";
}

export default async function PortalInsuranceCrosswalkPage({
  searchParams,
}: Readonly<{
  searchParams?: SearchParamsInput;
}>) {
  const portalState = await getPortalWorkspaceState();
  const editing = await isEditMode(searchParams);
  const insuranceUsesLocationRules = portalState.draft.locations.some(
    (location) => location.insuranceVaries || location.insuranceNotes,
  );
  const isReviewed = portalState.sections.find(
    (section) => section.key === "insuranceCrosswalk",
  )?.complete;
  const shouldShowDocument = portalState.launched && !editing;
  const primaryLabel = portalState.launched ? "Save changes" : "Save and continue";
  const returnHref = portalState.launched
    ? "/portal/app/insurance-crosswalk"
    : "/portal/app/onboarding";
  const returnLabel = portalState.launched ? "Back to document" : "Back to onboarding";

  if (shouldShowDocument) {
    const locationRules = portalState.draft.locations.filter(
      (location) => location.insuranceVaries || location.insuranceNotes,
    );

    return (
      <div className="space-y-6">
        <DocumentPageHeader
          actionHref="/portal/app/insurance-crosswalk?mode=edit"
          description="A structured crosswalk for what coverage guidance the AI receptionist can give and what should be escalated."
          eyebrow="Documents"
          title="Insurance crosswalk"
        />

        <DocumentPanel>
          <DocumentSection
            description="Plans the practice is comfortable listing as accepted."
            title="Accepted plans"
          >
            <DocumentText value={portalState.draft.insuranceAcceptedPlans} />
          </DocumentSection>

          <DocumentSection
            description="Plan caveats, authorization notes, and cases that need careful handling."
            title="Exceptions"
          >
            <DocumentText value={portalState.draft.insuranceExceptions} />
          </DocumentSection>

          <DocumentSection
            description="Location-specific plan acceptance or coverage rules."
            title="Location rules"
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
                      <DocumentText value={location.insuranceNotes} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <DocumentText value="" empty="Same insurance rules for all locations." />
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
          Insurance Crosswalk
        </p>
        <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
          {portalState.launched ? "Edit insurance crosswalk" : "Insurance rules"}
        </h2>
        <p className="max-w-2xl text-base leading-relaxed text-[#617477]">
          Keep this structured around coverage guidance and plan exceptions.
        </p>
      </section>

      <Card className="rounded-[1.8rem] border-black/6 bg-white">
        <CardHeader>
          <CardTitle>{isReviewed ? "Insurance saved" : "Finish this step"}</CardTitle>
          <CardDescription>Accepted plans and exceptions.</CardDescription>
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
