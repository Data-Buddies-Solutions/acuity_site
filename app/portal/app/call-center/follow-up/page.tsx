import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/app/components/ui/button";
import { getPortalCallCenterData } from "@/lib/call-center";
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
  const page = parseFollowUpPage(
    Array.isArray(params.page) ? params.page[0] : params.page,
  );
  const data = await getPortalCallCenterData({
    locationId: selectedLocationId,
  });

  if (!data) {
    redirect("/portal");
  }

  const totalThreads = data.needsAction.length;
  const totalPages = Math.max(1, Math.ceil(totalThreads / FOLLOW_UP_PAGE_SIZE));

  if (totalThreads > 0 && page > totalPages) {
    redirect(followUpHref({ office: selectedLocationId, page: totalPages }));
  }

  const start = (page - 1) * FOLLOW_UP_PAGE_SIZE;
  const visibleThreads = data.needsAction.slice(start, start + FOLLOW_UP_PAGE_SIZE);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PracticePageHeader
        branding={data.branding}
        practiceName={data.practiceName}
        title="Follow-up"
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
            <Link href={commandCenterHref(selectedLocationId)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Command center
            </Link>
          </Button>
        </div>
      </PracticePageHeader>

      <FollowUpCommandCenter
        office={selectedLocationId}
        page={page}
        threads={visibleThreads}
        totalPages={totalPages}
        totalThreads={totalThreads}
      />
    </div>
  );
}

function commandCenterHref(office?: string) {
  return office
    ? `/portal/app/call-center?office=${encodeURIComponent(office)}`
    : "/portal/app/call-center";
}

function followUpHref({ office, page }: { office?: string; page: number }) {
  const params = new URLSearchParams();

  if (office) {
    params.set("office", office);
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
