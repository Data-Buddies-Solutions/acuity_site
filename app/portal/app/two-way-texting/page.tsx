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

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:h-[calc(100dvh-8rem)]">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-semibold leading-tight text-[var(--portal-ink)] md:text-[2rem]">
            Two-way Texting
          </h1>
          <p className="mt-1.5 text-sm text-[var(--portal-muted)]">
            <span className="font-mono font-semibold tabular-nums text-[var(--portal-ink-soft)]">
              {inbox.unreadCount}
            </span>{" "}
            unread across {inbox.conversations.length} conversations
          </p>
        </div>
        <div className="w-full sm:w-auto">
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
