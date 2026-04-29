import { redirect } from "next/navigation";

import { Button } from "@/app/components/ui/button";
import { getPortalCallCenterData, resolveTelnyxRuntimeSettings } from "@/lib/call-center";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import MetricCard from "../overview/MetricCard";

import CallCenterWorkspace from "./CallCenterWorkspace";
import LocationPicker from "./LocationPicker";
import { enableCallCenterAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;

export default async function PortalCallCenterPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  const params = searchParams ? await searchParams : {};
  const selectedLocationId = Array.isArray(params.office)
    ? params.office[0]
    : params.office;

  const data = await getPortalCallCenterData({
    locationId: selectedLocationId,
  });

  if (!data) {
    redirect("/portal");
  }

  const settings = data.settings;
  const enabled = settings?.enabled === true;
  const runtimeSettings = settings ? resolveTelnyxRuntimeSettings(settings) : null;
  const selectedLocation = data.selectedLocation;
  const outboundCallerNumber =
    selectedLocation?.outboundNumber ||
    runtimeSettings?.outboundCallerNumber ||
    data.phoneNumbers.find((phone) => phone.isPrimary)?.phoneNumber ||
    data.phoneNumbers[0]?.phoneNumber ||
    "";
  const configured = Boolean(
    enabled &&
    runtimeSettings?.connectionId &&
    runtimeSettings.credentialId &&
    outboundCallerNumber,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-[#10272c] md:text-4xl">
            {selectedLocation ? `${selectedLocation.label} Call Center` : "Call Center"}
          </h1>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {selectedLocation ? (
            <LocationPicker currentId={selectedLocation.id} locations={data.locations} />
          ) : null}
          {!enabled ? (
            <form action={enableCallCenterAction}>
              <Button variant="primary">Enable</Button>
            </form>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <MetricCard label="Missed" value={String(data.totals.missedCalls)} />
        <MetricCard label="Voicemails" value={String(data.totals.voicemails)} />
      </section>

      <CallCenterWorkspace
        activity={data.activity}
        configured={configured}
        enabled={enabled}
        outboundCallerNumber={outboundCallerNumber}
      />
    </div>
  );
}
