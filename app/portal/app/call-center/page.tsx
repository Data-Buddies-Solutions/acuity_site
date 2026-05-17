import { redirect } from "next/navigation";

import { Button } from "@/app/components/ui/button";
import { getPortalCallCenterData, resolveTelnyxRuntimeSettings } from "@/lib/call-center";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import { PracticePageHeader } from "../PracticePageHeader";

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
  const practiceWideOutboundCallerNumber =
    selectedLocation?.outboundNumber ||
    runtimeSettings?.outboundCallerNumber ||
    data.phoneNumbers.find((phone) => phone.isPrimary)?.phoneNumber ||
    data.phoneNumbers[0]?.phoneNumber ||
    "";
  const outboundCallerNumber = data.hasAllLocationAccess
    ? practiceWideOutboundCallerNumber
    : selectedLocation?.outboundNumber || "";
  const voicemailTimeoutSec = Math.max(1, settings?.voicemailTimeoutSec ?? 8);
  const hasSeatCredential = data.seats.some((seat) => seat.hasCredential);
  const needsSeatCredential = data.seats.length > 0;
  const configured = Boolean(
    enabled &&
    runtimeSettings?.connectionId &&
    (needsSeatCredential ? hasSeatCredential : runtimeSettings.credentialId) &&
    outboundCallerNumber,
  );
  const configurationMessage =
    !data.hasAllLocationAccess && data.seats.length === 0
      ? "No assigned call center station is configured for this location."
      : needsSeatCredential
        ? "Add a Telnyx credential ID to at least one station for this location before staff can register."
        : "Telnyx is missing connection details. Add the connection ID, credential ID, and caller number to start placing calls.";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PracticePageHeader
        branding={data.branding}
        practiceName={data.practiceName}
        title="Call Center"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {selectedLocation ? (
            <LocationPicker currentId={selectedLocation.id} locations={data.locations} />
          ) : null}
          {!enabled && data.hasAllLocationAccess ? (
            <form action={enableCallCenterAction}>
              <Button variant="primary">Enable</Button>
            </form>
          ) : null}
        </div>
      </PracticePageHeader>

      <CallCenterWorkspace
        activity={data.activity}
        configured={configured}
        configurationMessage={configurationMessage}
        enabled={enabled}
        eventLocationId={selectedLocation?.locationId}
        inboundEnabled={data.inboundEnabled}
        outboundCallerNumber={outboundCallerNumber}
        outboundCallerNumbers={data.outboundCallerNumbers}
        queue={data.queue}
        seats={data.seats}
        totals={data.totals}
        voicemailTimeoutSec={voicemailTimeoutSec}
      />
    </div>
  );
}
