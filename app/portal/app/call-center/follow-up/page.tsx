import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getPortalCallCenterData } from "@/lib/call-center";
import { readCombinedNeedsAction } from "@/lib/call-center/application/portal-combined-call-center-reads";
import { readPortalCanonicalWorkspace } from "@/lib/call-center/application/portal-canonical-workspace";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import LocationPicker from "../LocationPicker";
import { PracticePageHeader } from "../../PracticePageHeader";

import FollowUpCommandCenter from "./FollowUpCommandCenter";

export const dynamic = "force-dynamic";

type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;
const FOLLOW_UP_PAGE_SIZE = 25;

export default async function PortalCallCenterFollowUpPage({
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
  const requestedQueueId = Array.isArray(params.queue) ? params.queue[0] : params.queue;
  const page = parseFollowUpPage(
    Array.isArray(params.page) ? params.page[0] : params.page,
  );
  const data = await getPortalCallCenterData({
    excludeCanonicalLinkedActivity: true,
    locationId: selectedLocationId,
    needsActionPage: 1,
    needsActionPageSize: 100,
  });

  if (!data) {
    redirect("/portal");
  }

  const selectedCanonicalLocationIds = data.selectedLocation?.locationIds?.length
    ? data.selectedLocation.locationIds
    : data.selectedLocation?.locationId
      ? [data.selectedLocation.locationId]
      : [];
  const selectedOfficeId = data.selectedLocation?.id ?? selectedLocationId;
  const canonicalWorkspace = requestedQueueId
    ? await readPortalCanonicalWorkspace(
        selectedCanonicalLocationIds,
        true,
        requestedQueueId,
      )
    : null;
  const invalidRequestedQueue = Boolean(
    requestedQueueId && canonicalWorkspace?.queueId !== requestedQueueId,
  );
  if (invalidRequestedQueue && canonicalWorkspace) {
    redirect(
      followUpHref({
        office: selectedOfficeId,
        page,
        queue: canonicalWorkspace.queueId,
      }),
    );
  }
  const selectedQueueId = invalidRequestedQueue ? undefined : requestedQueueId;
  const combinedNeedsAction = await readCombinedNeedsAction(
    {
      legacyGroups: data.needsAction,
      legacyGroupIds: data.needsActionIds,
      legacyTotal: data.needsActionTotal,
      locationIds: selectedCanonicalLocationIds,
      page,
      pageSize: FOLLOW_UP_PAGE_SIZE,
      queueId: selectedQueueId,
    },
    {
      ...(invalidRequestedQueue ? { readCanonical: async () => null } : {}),
      readLegacy: async (legacyPage, pageSize) => {
        const result = await getPortalCallCenterData({
          excludeCanonicalLinkedActivity: true,
          locationId: selectedLocationId,
          needsActionPage: legacyPage,
          needsActionPageSize: pageSize,
        });
        return {
          items: result?.needsAction ?? [],
          total: result?.needsActionTotal ?? 0,
        };
      },
    },
  );

  const threads = combinedNeedsAction.groups;
  const totalThreads = combinedNeedsAction.total;
  const totalPages = Math.max(1, Math.ceil(totalThreads / FOLLOW_UP_PAGE_SIZE));

  if (totalThreads > 0 && page > totalPages) {
    redirect(
      followUpHref({
        office: selectedOfficeId,
        page: totalPages,
        queue: selectedQueueId,
      }),
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PracticePageHeader
        branding={data.branding}
        practiceName={data.practiceName}
        showLogo={false}
        title="Needs action"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {data.selectedLocation ? (
            <LocationPicker
              basePath="/portal/app/call-center/follow-up"
              currentId={data.selectedLocation.id}
              locations={data.locations}
              showLabel={false}
            />
          ) : null}
          <Button asChild variant="secondary">
            <Link href={commandCenterHref(selectedOfficeId, selectedQueueId)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Command center
            </Link>
          </Button>
        </div>
      </PracticePageHeader>

      <FollowUpCommandCenter
        office={selectedOfficeId}
        page={page}
        queue={selectedQueueId}
        threads={threads}
        totalPages={totalPages}
        totalThreads={totalThreads}
      />
    </div>
  );
}

function commandCenterHref(office?: string, queue?: string) {
  const params = new URLSearchParams();
  if (office) params.set("office", office);
  if (queue) params.set("queue", queue);
  const query = params.toString();
  return `/portal/app/call-center${query ? `?${query}` : ""}`;
}

function followUpHref({
  office,
  page,
  queue,
}: {
  office?: string;
  page: number;
  queue?: string;
}) {
  const params = new URLSearchParams();

  if (office) {
    params.set("office", office);
  }

  if (queue) {
    params.set("queue", queue);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();
  return query
    ? `/portal/app/call-center/follow-up?${query}`
    : "/portal/app/call-center/follow-up";
}

function parseFollowUpPage(value: string | undefined) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.max(1, Math.round(parsed));
}
