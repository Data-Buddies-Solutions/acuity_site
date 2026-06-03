import { redirect } from "next/navigation";

import { getPortalWorkspaceState } from "@/lib/portal-state";
import { getSmsInbox } from "@/lib/sms/service";

import { PracticePageHeader } from "../PracticePageHeader";

import TextingHeaderPicker from "./TextingHeaderPicker";
import TwoWayTextingWorkspace from "./TwoWayTextingWorkspace";

export const dynamic = "force-dynamic";

type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;

export default async function PortalTwoWayTextingPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  const params = searchParams ? await searchParams : {};
  const selectedInboxId = Array.isArray(params.inbox) ? params.inbox[0] : params.inbox;
  const inbox = await getSmsInbox(selectedInboxId);

  if (!inbox) {
    redirect("/portal");
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PracticePageHeader
        branding={portalState.branding}
        eyebrow="Practice texting"
        practiceName={inbox.practiceName}
        title="Two-way Texting"
      >
        <TextingHeaderPicker
          options={inbox.availableInboxes}
          selectedId={inbox.selectedInboxId}
        />
      </PracticePageHeader>

      <TwoWayTextingWorkspace initialInbox={inbox} />
    </div>
  );
}
