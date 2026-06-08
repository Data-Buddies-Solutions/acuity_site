import { redirect } from "next/navigation";

import { getPortalWorkspaceState } from "@/lib/portal-state";
import { getSmsInbox } from "@/lib/sms/service";

import TextingHeaderPicker from "./TextingHeaderPicker";
import TwoWayTextingWorkspace from "./TwoWayTextingWorkspace";

export const dynamic = "force-dynamic";

type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;

function TextingSummary({
  conversationCount,
  unreadCount,
}: {
  conversationCount: number;
  unreadCount: number;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-3">
      <div className="inline-flex items-end gap-3 rounded-xl border border-[var(--portal-border)] bg-white px-4 py-3 shadow-sm">
        <span className="font-mono text-3xl font-semibold leading-none tabular-nums text-[#536a91]">
          {unreadCount}
        </span>
        <span className="pb-0.5 text-sm font-semibold uppercase tracking-normal text-[var(--portal-muted)]">
          Unread
        </span>
      </div>
      <div className="inline-flex items-end gap-3 rounded-xl border border-[var(--portal-border)] bg-white px-4 py-3 shadow-sm">
        <span className="font-mono text-3xl font-semibold leading-none tabular-nums text-[#536a91]">
          {conversationCount}
        </span>
        <span className="pb-0.5 text-sm font-semibold uppercase tracking-normal text-[var(--portal-muted)]">
          Total {conversationCount === 1 ? "conversation" : "conversations"}
        </span>
      </div>
    </div>
  );
}

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

  const selectedInboxLabel =
    inbox.availableInboxes.find((option) => option.id === inbox.selectedInboxId)?.label ??
    inbox.locationName ??
    "Texting";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-4xl font-semibold leading-tight tracking-normal text-[#151a24] md:text-5xl">
            Two-way Texting
          </h1>
          <TextingSummary
            conversationCount={inbox.conversations.length}
            unreadCount={inbox.unreadCount}
          />
        </div>
        <div className="flex w-full flex-col gap-2 lg:w-auto lg:items-end">
          <p className="text-xs font-semibold uppercase tracking-normal text-[var(--portal-muted-soft)]">
            Inbox: <span className="text-[#536a91]">{selectedInboxLabel}</span>
          </p>
          <TextingHeaderPicker
            options={inbox.availableInboxes}
            selectedId={inbox.selectedInboxId}
          />
        </div>
      </section>

      <TwoWayTextingWorkspace key={inbox.selectedInboxId} initialInbox={inbox} />
    </div>
  );
}
