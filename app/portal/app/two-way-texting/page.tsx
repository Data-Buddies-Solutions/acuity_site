import { redirect } from "next/navigation";

import { getPortalWorkspaceState } from "@/lib/portal-state";
import {
  getSmsConversation,
  getSmsInbox,
  type SmsConversationListItem,
} from "@/lib/sms/service";

import TextingHeaderPicker from "./TextingHeaderPicker";
import TwoWayTextingWorkspace from "./TwoWayTextingWorkspace";

export const dynamic = "force-dynamic";

type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;
type ConversationFilter = "OPEN" | "CLOSED" | "UNREAD";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseConversationFilter(value: string | undefined): ConversationFilter {
  return value === "CLOSED" || value === "UNREAD" ? value : "OPEN";
}

function conversationMatchesFilter(
  conversation: SmsConversationListItem,
  filter: ConversationFilter,
) {
  return filter === "UNREAD" ? conversation.unread : conversation.status === filter;
}

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
  const selectedInboxId = firstParam(params.inbox);
  const requestedConversationId = firstParam(params.conversation);
  const initialFilter = parseConversationFilter(firstParam(params.filter));
  const initialSearchQuery = firstParam(params.search)?.trim() ?? "";
  const inbox = await getSmsInbox(selectedInboxId, initialSearchQuery);

  if (!inbox) {
    redirect("/portal");
  }

  const selectedConversationId =
    inbox.conversations.find(
      (conversation) =>
        conversation.id === requestedConversationId &&
        conversationMatchesFilter(conversation, initialFilter),
    )?.id ??
    inbox.conversations.find((conversation) =>
      conversationMatchesFilter(conversation, initialFilter),
    )?.id ??
    "";
  const initialConversationResult = selectedConversationId
    ? await getSmsConversation(selectedConversationId)
    : null;
  const initialConversation =
    initialConversationResult && !("notFound" in initialConversationResult)
      ? initialConversationResult
      : null;

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

      <TwoWayTextingWorkspace
        key={inbox.selectedInboxId}
        initialConversation={initialConversation}
        initialFilter={initialFilter}
        initialInbox={inbox}
        initialSearchQuery={initialSearchQuery}
        initialSelectedConversationId={selectedConversationId}
      />
    </div>
  );
}
