import { redirect } from "next/navigation";

import { getPortalCallCenterData, resolveTelnyxRuntimeSettings } from "@/lib/call-center";
import { readPortalCanonicalWorkspace } from "@/lib/call-center/application/portal-canonical-workspace";
import { resolvePortalCallCenterActivationConfig } from "@/lib/call-center/infrastructure/call-center-activation-config";
import { createLogger } from "@/lib/logger";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import { PracticePageHeader } from "../PracticePageHeader";

import CallCenterWorkspace from "./CallCenterWorkspace";
import { CanonicalActiveWorkspace } from "./CanonicalActiveWorkspace";
import { EnableCallCenterControl } from "./EnableCallCenterControl";
import LocationPicker from "./LocationPicker";
import { QueuePicker } from "./QueuePicker";

export const dynamic = "force-dynamic";
const logger = createLogger("portal-call-center-page");

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
  const activation = resolvePortalCallCenterActivationConfig();
  const canonicalActivation = activation.enabled;
  if (!activation.valid) {
    logger.error("canonical activation configuration invalid", {
      errorCode: "INVALID_CALL_CENTER_ACTIVATION_CONFIG",
    });
  }
  const selectedLocationId = Array.isArray(params.office)
    ? params.office[0]
    : params.office;
  const initialDialNumber = Array.isArray(params.call) ? params.call[0] : params.call;
  const selectedQueueId = Array.isArray(params.queue) ? params.queue[0] : params.queue;

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
  const selectedCanonicalLocationIds = selectedLocation?.locationIds?.length
    ? selectedLocation.locationIds
    : selectedLocation?.locationId
      ? [selectedLocation.locationId]
      : [];
  const canonicalWorkspace = activation.valid
    ? await readPortalCanonicalWorkspace(
        selectedCanonicalLocationIds,
        canonicalActivation,
        selectedQueueId,
      )
    : null;
  const selectedOfficeId = selectedLocation?.id ?? selectedLocationId ?? null;
  const practiceWideOutboundCallerNumber =
    selectedLocation?.outboundNumber ||
    runtimeSettings?.outboundCallerNumber ||
    data.phoneNumbers.find((phone) => phone.isPrimary)?.phoneNumber ||
    data.phoneNumbers[0]?.phoneNumber ||
    "";
  const outboundCallerNumber = data.hasAllLocationAccess
    ? practiceWideOutboundCallerNumber
    : selectedLocation?.outboundNumber || "";
  const followUpHref = selectedOfficeId
    ? `/portal/app/call-center/follow-up?office=${encodeURIComponent(selectedOfficeId)}`
    : "/portal/app/call-center/follow-up";
  const historyHref = "/portal/app/call-center/history";
  const voicemailTimeoutSec = Math.max(1, settings?.voicemailTimeoutSec ?? 30);
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
        logoMeta="Answer and place patient calls."
        practiceName={data.practiceName}
        showLogo={false}
        size="compact"
        title="Call Center"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {selectedLocation ? (
            <LocationPicker
              currentId={selectedLocation.id}
              guardCurrentCall={
                canonicalActivation || Boolean(canonicalWorkspace?.drainingCanonical)
              }
              locations={data.locations}
              showLabel={false}
            />
          ) : null}
          {canonicalWorkspace && canonicalWorkspace.availableQueues.length > 1 ? (
            <QueuePicker
              currentId={canonicalWorkspace.queueId}
              office={selectedOfficeId}
              queues={canonicalWorkspace.availableQueues}
            />
          ) : null}
          {!enabled && data.hasAllLocationAccess ? <EnableCallCenterControl /> : null}
        </div>
      </PracticePageHeader>

      {canonicalActivation || canonicalWorkspace?.drainingCanonical ? (
        <CanonicalActiveWorkspace
          actionsEnabled={canonicalActivation}
          enabled={enabled}
          historyHref={historyHref}
          outboundNumbers={canonicalWorkspace?.outboundNumbers ?? []}
          queueId={canonicalWorkspace?.queueId ?? null}
        />
      ) : (
        <CallCenterWorkspace
          configured={configured}
          configurationMessage={configurationMessage}
          enabled={enabled}
          eventLocationId={selectedLocation?.locationId}
          followUpHref={followUpHref}
          historyHref={historyHref}
          initialDialNumber={initialDialNumber}
          inboundEnabled={data.inboundEnabled}
          needsAction={data.needsAction}
          office={selectedOfficeId}
          outboundCallerNumber={outboundCallerNumber}
          outboundCallerNumbers={data.outboundCallerNumbers}
          queue={data.queue}
          recentCalls={data.recentCalls}
          seats={data.seats}
          shadowQueueId={canonicalWorkspace?.queueId ?? null}
          totals={data.totals}
          voicemailTimeoutSec={voicemailTimeoutSec}
        />
      )}
    </div>
  );
}
