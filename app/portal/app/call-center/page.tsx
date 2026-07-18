import { redirect } from "next/navigation";

import { readPortalCallCenterPage } from "@/lib/call-center/application/portal-canonical-workspace";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import { PracticePageHeader } from "../PracticePageHeader";

import { CanonicalActiveWorkspace } from "./CanonicalActiveWorkspace";
import LocationPicker from "./LocationPicker";
import { QueuePicker } from "./QueuePicker";

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
  const initialDialNumber = Array.isArray(params.call) ? params.call[0] : params.call;
  const selectedQueueId = Array.isArray(params.queue) ? params.queue[0] : params.queue;
  const data = await readPortalCallCenterPage(selectedLocationId, selectedQueueId);

  if (!data) {
    redirect("/portal");
  }

  const selectedLocation = data.selectedLocation;
  const canonicalWorkspace = data.workspace;
  const selectedOfficeId = selectedLocation?.id ?? selectedLocationId ?? null;
  const followUpParams = new URLSearchParams();
  if (selectedOfficeId) followUpParams.set("office", selectedOfficeId);
  if (canonicalWorkspace?.queueId) {
    followUpParams.set("queue", canonicalWorkspace.queueId);
  }
  const followUpQuery = followUpParams.toString();
  const followUpHref = `/portal/app/call-center/follow-up${
    followUpQuery ? `?${followUpQuery}` : ""
  }`;
  const historyHref = "/portal/app/call-center/history";

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
              guardCurrentCall
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
        </div>
      </PracticePageHeader>

      <CanonicalActiveWorkspace
        followUpHref={followUpHref}
        historyHref={historyHref}
        initialDialNumber={initialDialNumber}
        needsAction={data.needsAction}
        needsActionCount={data.needsActionCount}
        office={selectedOfficeId}
        outboundNumbers={canonicalWorkspace?.outboundNumbers ?? []}
        queueId={canonicalWorkspace?.queueId ?? null}
      />
    </div>
  );
}
