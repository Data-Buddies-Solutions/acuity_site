import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import {
  DetailGrid,
  DetailItem,
  DocumentPageHeader,
  DocumentPanel,
  DocumentSection,
  DocumentText,
} from "@/app/portal/app/DocumentView";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import LocationSetupForm from "../onboarding/LocationSetupForm";
import ProviderSetupForm from "../onboarding/ProviderSetupForm";

type SearchParamsInput =
  | Promise<Record<string, string | string[] | undefined>>
  | undefined;

async function isEditMode(searchParams: SearchParamsInput) {
  const resolved = (await searchParams) || {};
  const rawMode = Array.isArray(resolved.mode) ? resolved.mode[0] : resolved.mode;

  return rawMode === "edit";
}

export default async function PracticeInformationPage({
  searchParams,
}: Readonly<{
  searchParams?: SearchParamsInput;
}>) {
  const portalState = await getPortalWorkspaceState();
  const { draft } = portalState;
  const editing = await isEditMode(searchParams);

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  if (editing) {
    const locationNames = draft.locations
      .map((location) => location.locationName)
      .filter(Boolean);

    return (
      <div className="space-y-6">
        <DocumentPageHeader
          description="Update the practice profile, locations, and provider routing details collected during setup."
          eyebrow="Documents"
          title="Edit practice information"
        />

        <Card className="rounded-[1.8rem] border-black/6 bg-white">
          <CardHeader>
            <CardTitle>Practice basics and locations</CardTitle>
            <CardDescription>
              Update office details patients and staff rely on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LocationSetupForm
              backHref="/portal/app/practice-information"
              initialLocations={draft.locations}
              practiceName={draft.practiceName}
              submitLabel="Save practice info"
            />
          </CardContent>
        </Card>

        <Card className="rounded-[1.8rem] border-black/6 bg-white">
          <CardHeader>
            <CardTitle>Providers</CardTitle>
            <CardDescription>
              Update provider routing details or remove providers that should no longer
              appear.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProviderSetupForm
              allowEmptyProviders
              backHref="/portal/app/practice-information"
              initialProviders={draft.providers}
              locationNames={locationNames}
              submitLabel="Save providers"
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DocumentPageHeader
        actionHref="/portal/app/practice-information?mode=edit"
        description="The core practice profile the AI receptionist uses to understand locations, provider routing, and office contact details."
        eyebrow="Documents"
        title="Practice information"
      />

      <DocumentPanel>
        <DocumentSection
          description="Basic identity and workspace summary."
          title="Practice profile"
        >
          <DetailGrid>
            <DetailItem label="Practice name" value={draft.practiceName} />
            <DetailItem label="Locations" value={draft.locations.length} />
            <DetailItem label="Providers" value={draft.providers.length} />
            <DetailItem label="Website" value={draft.websiteUrl} />
          </DetailGrid>
        </DocumentSection>

        <DocumentSection
          description="Office details patients and staff rely on."
          title="Locations"
        >
          {draft.locations.length ? (
            <div className="space-y-3">
              {draft.locations.map((location, index) => (
                <div
                  key={location.id || `${location.locationName}-${index}`}
                  className="rounded-2xl border border-black/6 bg-[#f7fbfa] px-4 py-4"
                >
                  <p className="text-sm font-semibold text-[#10272c]">
                    {location.locationName || `Location ${index + 1}`}
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <DetailItem label="Address" value={location.address} />
                    <DetailItem label="Phone" value={location.phone} />
                    <DetailItem label="Fax" value={location.fax} />
                    <DetailItem label="Hours" value={location.hours} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <DocumentText value="" empty="No locations have been added yet." />
          )}
        </DocumentSection>

        <DocumentSection
          description="Provider routing details collected during setup."
          title="Providers"
        >
          {draft.providers.length ? (
            <div className="space-y-3">
              {draft.providers.map((provider, index) => (
                <div
                  key={provider.id || `${provider.providerName}-${index}`}
                  className="rounded-2xl border border-black/6 bg-[#f7fbfa] px-4 py-4"
                >
                  <p className="text-sm font-semibold text-[#10272c]">
                    {provider.providerName || `Provider ${index + 1}`}
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <DetailItem label="Specialty" value={provider.providerSpecialty} />
                    <DetailItem label="NPI" value={provider.providerNpi} />
                    <DetailItem
                      label="Primary location"
                      value={provider.providerLocation}
                    />
                    <DetailItem label="Hours" value={provider.providerHours} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <DocumentText value="" empty="No providers have been added yet." />
          )}
        </DocumentSection>
      </DocumentPanel>
    </div>
  );
}
