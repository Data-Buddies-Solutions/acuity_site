"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCheck,
  Circle,
  Loader2,
  Lock,
  MessageSquareText,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";

type SmsConversationStatus = "OPEN" | "CLOSED";
type SmsMessageDirection = "INBOUND" | "OUTBOUND";
type SmsMessageStatus =
  | "QUEUED"
  | "SENDING"
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "RECEIVED";

type ConversationListItem = {
  id: string;
  lastInboundAt: string | null;
  lastMessageAt: string;
  lastMessageDirection: SmsMessageDirection;
  lastMessagePreview: string;
  lastMessageStatus: SmsMessageStatus;
  locationName: string | null;
  optedOut: boolean;
  patientPhoneNumber: string;
  patientPhoneNumberDisplay: string;
  status: SmsConversationStatus;
  unread: boolean;
};

type MessageItem = {
  body: string;
  createdAt: string;
  direction: SmsMessageDirection;
  errorDetail: string | null;
  id: string;
  sentByName: string | null;
  status: SmsMessageStatus;
};

type ConversationDetail = ConversationListItem & {
  messages: MessageItem[];
  practiceNumber: string;
  readBy: Array<{
    lastReadAt: string;
    name: string;
  }>;
};

type InboxState = {
  availableInboxes: Array<{
    id: string;
    label: string;
    locationName: string | null;
    phoneNumber: string;
  }>;
  configured: boolean;
  conversations: ConversationListItem[];
  currentUserId: string;
  locationName: string;
  practiceName: string;
  practiceNumber: string;
  selectedInboxId: string;
  unreadCount: number;
};

type StartConversationResponse = {
  conversationId: string;
  detail?: string | null;
  error?: string;
  messageId: string;
  ok: boolean;
};

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});

function formatMessageTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  return sameDay ? timeFormatter.format(date) : dateFormatter.format(date);
}

function deliveryLabel(status: SmsMessageStatus) {
  switch (status) {
    case "DELIVERED":
      return "Delivered";
    case "FAILED":
      return "Failed";
    case "QUEUED":
    case "SENDING":
      return "Sending";
    case "SENT":
      return "Sent";
    default:
      return "Received";
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : "Request failed";
    throw new Error(message);
  }

  return payload as T;
}

function EmptyThread() {
  return (
    <div className="flex h-full min-h-72 flex-col items-center justify-center border-l border-black/6 bg-white px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e8f4f4] text-[#0d7377]">
        <MessageSquareText className="h-7 w-7" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-[#10272c]">
        No conversation selected
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[#617477]">
        Incoming texts will appear in the list. Select one to read and reply.
      </p>
    </div>
  );
}

function MessageBubble({ message }: { message: MessageItem }) {
  const outbound = message.direction === "OUTBOUND";
  const failed = message.status === "FAILED";

  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-xl px-3.5 py-2.5 shadow-sm",
          outbound
            ? "rounded-br-sm bg-[#0d7377] text-white"
            : "rounded-bl-md border border-black/8 bg-white text-[#10272c]",
          failed && "bg-[#fff1f1] text-[#8a1f1f]",
        )}
      >
        <p
          className={cn(
            "whitespace-pre-wrap text-sm leading-5",
            outbound && !failed ? "text-white" : "text-[#10272c]",
            failed && "text-[#8a1f1f]",
          )}
        >
          {message.body}
        </p>
        <div
          className={cn(
            "mt-1.5 flex items-center gap-2 text-[11px]",
            outbound && !failed ? "text-white/80" : "text-[#7d8d90]",
            failed && "text-[#8a1f1f]",
          )}
        >
          <span>{formatMessageTime(message.createdAt)}</span>
          {outbound ? (
            <>
              <span aria-hidden="true">.</span>
              <span>{deliveryLabel(message.status)}</span>
            </>
          ) : null}
        </div>
        {failed && message.errorDetail ? (
          <p className="mt-2 text-xs leading-5 text-[#8a1f1f]">{message.errorDetail}</p>
        ) : null}
      </div>
    </div>
  );
}

function ConversationRow({
  conversation,
  selected,
  onSelect,
}: {
  conversation: ConversationListItem;
  onSelect: (id: string) => void;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-4 text-left transition",
        selected ? "bg-[#e8f4f4]" : "bg-white hover:bg-[#f7fbfb]",
      )}
      onClick={() => onSelect(conversation.id)}
    >
      <span
        className={cn(
          "mt-1 h-2.5 w-2.5 rounded-full",
          conversation.unread ? "bg-[#0d7377]" : "bg-transparent ring-1 ring-black/12",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-semibold text-[#10272c]">
            {conversation.patientPhoneNumberDisplay}
          </span>
          <span className="shrink-0 text-xs text-[#7d8d90]">
            {formatMessageTime(conversation.lastMessageAt)}
          </span>
        </span>
        <span className="mt-1 block truncate text-sm text-[#617477]">
          {conversation.lastMessageDirection === "OUTBOUND" ? "You: " : ""}
          {conversation.lastMessagePreview || "No message body"}
        </span>
        <span className="mt-2 flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              conversation.status === "OPEN"
                ? "bg-[#edf8f1] text-[#287a48]"
                : "bg-[#eef1f2] text-[#617477]",
            )}
          >
            {conversation.status === "OPEN" ? "Open" : "Closed"}
          </span>
          {conversation.optedOut ? (
            <span className="rounded-full bg-[#fff1f1] px-2 py-0.5 text-[11px] font-semibold text-[#8a1f1f]">
              Opted out
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function DraftConversationRow({ body, phone }: { body: string; phone: string }) {
  return (
    <div className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 bg-[#e8f4f4] px-4 py-4 text-left transition">
      <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#0d7377]" aria-hidden="true" />
      <span className="min-w-0">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-semibold text-[#10272c]">
            {phone.trim() || "New text"}
          </span>
          <span className="shrink-0 text-xs text-[#7d8d90]">Draft</span>
        </span>
        <span className="mt-1 block truncate text-sm text-[#617477]">
          {body.trim() || "Write the first message"}
        </span>
        <span className="mt-2 flex items-center gap-2">
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#0d7377]">
            New
          </span>
        </span>
      </span>
    </div>
  );
}

function DraftConversationThread({
  body,
  error,
  onBodyChange,
  onCancel,
  onPhoneChange,
  onSubmit,
  phone,
  sending,
}: {
  body: string;
  error: string | null;
  onBodyChange: (value: string) => void;
  onCancel: () => void;
  onPhoneChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  phone: string;
  sending: boolean;
}) {
  const ready = Boolean(phone.trim() && body.trim());

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f6f8f8]">
      <header className="border-b border-black/6 bg-white px-4 py-3 md:px-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <label className="sr-only" htmlFor="new-sms-phone">
              Patient mobile
            </label>
            <div className="grid max-w-md grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border-b border-black/12 pb-1.5 transition focus-within:border-[#0d7377]">
              <span className="text-sm font-semibold text-[#7d8d90]">To</span>
              <input
                autoComplete="tel"
                className="h-7 w-full min-w-0 bg-transparent text-sm font-semibold text-[#10272c] outline-none placeholder:font-medium placeholder:text-[#9aa7a9]"
                disabled={sending}
                id="new-sms-phone"
                inputMode="tel"
                onChange={(event) => onPhoneChange(event.target.value)}
                placeholder="Patient mobile"
                type="tel"
                value={phone}
              />
            </div>
          </div>
          <Button
            aria-label="Close new text"
            className="h-9 w-9 border-black/10 bg-white p-0 text-[#617477] hover:bg-[#f1f5f5]"
            onClick={onCancel}
            type="button"
            variant="secondary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      {error ? (
        <div className="border-b border-[#ffd6d6] bg-[#fff7f7] px-4 py-2 text-sm text-[#8a1f1f]">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-5">
        <div className="grid min-h-[360px] place-items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e8f4f4] text-[#0d7377]">
            <MessageSquareText className="h-7 w-7" aria-hidden="true" />
          </div>
        </div>
      </div>

      <footer className="border-t border-black/6 bg-white px-4 py-2 md:px-5">
        <form onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="new-sms-body">
            Message
          </label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-stretch">
            <textarea
              className="h-10 resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-sm leading-5 text-[#10272c] outline-none transition placeholder:text-[#9aa7a9] focus:border-[#0d7377] focus:ring-2 focus:ring-[#0d7377]/15"
              disabled={sending}
              id="new-sms-body"
              maxLength={1000}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              onChange={(event) => onBodyChange(event.target.value)}
              placeholder="Write the first message..."
              value={body}
            />
            <Button
              className="h-10 px-4"
              disabled={sending || !ready}
              size="sm"
              type="submit"
              variant="primary"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send text
            </Button>
          </div>
        </form>
      </footer>
    </main>
  );
}

export default function TwoWayTextingWorkspace({
  initialInbox,
}: {
  initialInbox: InboxState;
}) {
  const [inbox, setInbox] = useState(initialInbox);
  const [selectedId, setSelectedId] = useState(initialInbox.conversations[0]?.id ?? "");
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [filter, setFilter] = useState<"OPEN" | "UNREAD" | "CLOSED">("OPEN");
  const [draft, setDraft] = useState("");
  const [newPatientPhone, setNewPatientPhone] = useState("");
  const [newDraft, setNewDraft] = useState("");
  const [composing, setComposing] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sending, setSending] = useState(false);
  const [startingOutbound, setStartingOutbound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredConversations = useMemo(() => {
    if (filter === "UNREAD") {
      return inbox.conversations.filter((item) => item.unread);
    }

    return inbox.conversations.filter((item) => item.status === filter);
  }, [filter, inbox.conversations]);

  const selectedConversation = useMemo(
    () => inbox.conversations.find((item) => item.id === selectedId) ?? null,
    [inbox.conversations, selectedId],
  );

  const selectConversation = useCallback((id: string) => {
    setComposing(false);
    setError(null);
    setSelectedId(id);
  }, []);

  const refreshInbox = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) {
        setRefreshing(true);
      }

      try {
        const query = inbox.selectedInboxId
          ? `?inboxId=${encodeURIComponent(inbox.selectedInboxId)}`
          : "";
        const next = await fetch(`/api/portal/sms/conversations${query}`, {
          cache: "no-store",
        }).then((response) => readJson<InboxState>(response));
        setInbox(next);
        setError(null);

        if (selectedId && !next.conversations.some((item) => item.id === selectedId)) {
          setSelectedId(next.conversations[0]?.id ?? "");
          setConversation(null);
        } else if (!selectedId && next.conversations[0]) {
          setSelectedId(next.conversations[0].id);
        }
      } catch (refreshError) {
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : "Failed to refresh inbox",
        );
      } finally {
        setRefreshing(false);
      }
    },
    [inbox.selectedInboxId, selectedId],
  );

  const refreshConversation = useCallback(
    async ({ quiet = false } = {}) => {
      if (!selectedId) {
        setConversation(null);
        return;
      }

      if (!quiet) {
        setLoadingThread(true);
      }

      try {
        const next = await fetch(`/api/portal/sms/conversations/${selectedId}`, {
          cache: "no-store",
        }).then((response) => readJson<ConversationDetail>(response));
        setConversation(next);
        setError(null);
      } catch (refreshError) {
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : "Failed to load conversation",
        );
      } finally {
        setLoadingThread(false);
      }
    },
    [selectedId],
  );

  useEffect(() => {
    void refreshConversation();
  }, [refreshConversation]);

  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshInbox({ quiet: true });
        void refreshConversation({ quiet: true });
      }
    }, 5_000);

    return () => clearInterval(poll);
  }, [refreshConversation, refreshInbox]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshInbox({ quiet: true });
        void refreshConversation({ quiet: true });
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refreshConversation, refreshInbox]);

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!conversation || !draft.trim()) {
      return;
    }

    setSending(true);
    setError(null);

    try {
      await fetch(`/api/portal/sms/conversations/${conversation.id}/messages`, {
        body: JSON.stringify({ body: draft }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }).then((response) => readJson<{ ok: boolean }>(response));
      setDraft("");
      await Promise.all([
        refreshInbox({ quiet: true }),
        refreshConversation({ quiet: true }),
      ]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  const handleStartOutbound = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!newPatientPhone.trim() || !newDraft.trim()) {
      return;
    }

    setStartingOutbound(true);
    setError(null);

    try {
      const result = await fetch("/api/portal/sms/conversations", {
        body: JSON.stringify({
          body: newDraft,
          inboxId: inbox.selectedInboxId,
          patientPhoneNumber: newPatientPhone,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }).then((response) => readJson<StartConversationResponse>(response));

      setFilter("OPEN");
      setSelectedId(result.conversationId);
      setNewPatientPhone("");
      setNewDraft("");
      setComposing(false);

      const query = inbox.selectedInboxId
        ? `?inboxId=${encodeURIComponent(inbox.selectedInboxId)}`
        : "";
      const [nextInbox, nextConversation] = await Promise.all([
        fetch(`/api/portal/sms/conversations${query}`, {
          cache: "no-store",
        }).then((response) => readJson<InboxState>(response)),
        fetch(`/api/portal/sms/conversations/${result.conversationId}`, {
          cache: "no-store",
        }).then((response) => readJson<ConversationDetail>(response)),
      ]);

      setInbox(nextInbox);
      setConversation(nextConversation);
      if (!result.ok) {
        setError(result.detail || result.error || "Failed to send text");
      }
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Failed to send text");
    } finally {
      setStartingOutbound(false);
    }
  };

  const handleStatus = async (status: SmsConversationStatus) => {
    if (!conversation) {
      return;
    }

    try {
      await fetch(`/api/portal/sms/conversations/${conversation.id}`, {
        body: JSON.stringify({ status }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }).then((response) => readJson<{ ok: boolean }>(response));
      await Promise.all([
        refreshInbox({ quiet: true }),
        refreshConversation({ quiet: true }),
      ]);
    } catch (statusError) {
      setError(
        statusError instanceof Error ? statusError.message : "Failed to update status",
      );
    }
  };

  const handleDelete = async () => {
    if (!conversation || conversation.status !== "CLOSED") {
      return;
    }

    const confirmed = window.confirm("Delete this closed conversation?");
    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      await fetch(`/api/portal/sms/conversations/${conversation.id}`, {
        method: "DELETE",
      }).then((response) => readJson<{ ok: boolean }>(response));

      const query = inbox.selectedInboxId
        ? `?inboxId=${encodeURIComponent(inbox.selectedInboxId)}`
        : "";
      const next = await fetch(`/api/portal/sms/conversations${query}`, {
        cache: "no-store",
      }).then((response) => readJson<InboxState>(response));

      setInbox(next);
      setSelectedId(next.conversations[0]?.id ?? "");
      setConversation(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete conversation",
      );
    } finally {
      setDeleting(false);
    }
  };

  if (!inbox.configured) {
    return (
      <section className="grid min-h-[560px] place-items-center border border-black/8 bg-white px-6 py-16 text-center shadow-sm">
        <div className="max-w-lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff6db] text-[#8a6500]">
            <AlertCircle className="h-7 w-7" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-xl font-semibold text-[#10272c]">
            Texting is not linked yet
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#617477]">
            This login does not have an assigned texting number. Add the practice phone
            number for the correct location, then send a test SMS to confirm Telnyx
            webhooks are creating conversations.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="grid h-[calc(100vh-165px)] min-h-[560px] grid-rows-[auto_minmax(0,1fr)] border border-black/8 bg-white shadow-sm">
      <div className="border-b border-black/6 bg-[#fbfdfd] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {[
              ["OPEN", "Open"],
              ["UNREAD", "Unread"],
              ["CLOSED", "Closed"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium transition",
                  filter === value
                    ? "bg-[#10272c] text-white"
                    : "bg-white text-[#617477] ring-1 ring-black/8 hover:text-[#10272c]",
                )}
                onClick={() => setFilter(value as typeof filter)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="bg-[#0d7377] text-white hover:bg-[#0b6467]"
              onClick={() => {
                setComposing(true);
                setError(null);
              }}
              size="sm"
              type="button"
              variant="primary"
            >
              <Plus className="h-4 w-4" />
              New text
            </Button>
            <Button
              className="border-black/10 bg-white text-[#10272c] hover:bg-[#f1f5f5]"
              disabled={refreshing}
              onClick={() => {
                void refreshInbox();
                void refreshConversation();
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="grid h-full min-h-0 overflow-hidden md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] border-b border-black/6 md:border-b-0 md:border-r">
          <div className="flex h-11 items-center justify-between border-b border-black/6 px-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7d8d90]">
              Conversations
            </p>
            <span className="rounded-full bg-[#e8f4f4] px-2.5 py-1 text-xs font-semibold text-[#0d7377]">
              {inbox.unreadCount} unread
            </span>
          </div>
          <div className="min-h-0 divide-y divide-black/6 overflow-y-auto">
            {composing ? (
              <DraftConversationRow body={newDraft} phone={newPatientPhone} />
            ) : null}
            {filteredConversations.length ? (
              filteredConversations.map((item) => (
                <ConversationRow
                  conversation={item}
                  key={item.id}
                  onSelect={selectConversation}
                  selected={item.id === selectedId}
                />
              ))
            ) : composing ? null : (
              <div className="px-6 py-14 text-center">
                <Circle className="mx-auto h-8 w-8 text-[#b2bfc1]" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium text-[#10272c]">
                  No {filter.toLowerCase()} conversations
                </p>
                <p className="mt-1 text-sm leading-6 text-[#617477]">
                  Texts to this inbox will appear here.
                </p>
              </div>
            )}
          </div>
        </aside>

        {composing ? (
          <DraftConversationThread
            body={newDraft}
            error={error}
            onBodyChange={setNewDraft}
            onCancel={() => {
              setComposing(false);
              setError(null);
            }}
            onPhoneChange={setNewPatientPhone}
            onSubmit={handleStartOutbound}
            phone={newPatientPhone}
            sending={startingOutbound}
          />
        ) : selectedConversation ? (
          <main className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f6f8f8]">
            {error ? (
              <div className="border-b border-[#ffd6d6] bg-[#fff7f7] px-4 py-2 text-sm text-[#8a1f1f]">
                {error}
              </div>
            ) : null}
            <header className="border-b border-black/6 bg-white px-4 py-3 md:px-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-[#10272c] md:text-lg">
                    {selectedConversation.patientPhoneNumberDisplay}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedConversation.status === "CLOSED" ? (
                    <Button
                      className="border-[#ffd6d6] bg-white text-[#8a1f1f] hover:bg-[#fff7f7]"
                      disabled={deleting}
                      onClick={() => void handleDelete()}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {deleting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Delete
                    </Button>
                  ) : null}
                  <Button
                    className="bg-white"
                    onClick={() =>
                      void handleStatus(
                        selectedConversation.status === "OPEN" ? "CLOSED" : "OPEN",
                      )
                    }
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <CheckCheck className="h-4 w-4" />
                    {selectedConversation.status === "OPEN" ? "Close" : "Reopen"}
                  </Button>
                </div>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
              {loadingThread ? (
                <div className="grid min-h-[360px] place-items-center text-[#617477]">
                  <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" />
                </div>
              ) : conversation?.messages.length ? (
                <div className="space-y-2.5">
                  {conversation.messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                </div>
              ) : (
                <div className="grid min-h-[360px] place-items-center text-sm text-[#617477]">
                  No messages loaded.
                </div>
              )}
            </div>

            <footer className="border-t border-black/6 bg-white px-4 py-2 md:px-5">
              {conversation?.optedOut ? (
                <div className="mb-3 flex items-center gap-2 rounded-lg bg-[#fff1f1] px-3 py-2 text-sm text-[#8a1f1f]">
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  This patient opted out. Replies are blocked.
                </div>
              ) : null}
              <form onSubmit={handleSend}>
                <label className="sr-only" htmlFor="sms-reply">
                  Reply
                </label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-stretch">
                  <textarea
                    className="h-10 resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-sm leading-5 text-[#10272c] outline-none transition placeholder:text-[#9aa7a9] focus:border-[#0d7377] focus:ring-2 focus:ring-[#0d7377]/15"
                    disabled={sending || Boolean(conversation?.optedOut)}
                    id="sms-reply"
                    maxLength={1000}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Write a reply..."
                    value={draft}
                  />
                  <Button
                    className="h-10 px-4"
                    disabled={sending || !draft.trim() || Boolean(conversation?.optedOut)}
                    size="sm"
                    type="submit"
                    variant="primary"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send
                  </Button>
                </div>
              </form>
            </footer>
          </main>
        ) : (
          <main className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
            {error ? (
              <div className="border-b border-[#ffd6d6] bg-[#fff7f7] px-4 py-2 text-sm text-[#8a1f1f]">
                {error}
              </div>
            ) : null}
            <div className="relative min-h-0 flex-1">
              <EmptyThread />
              <Button
                className="absolute left-1/2 top-[calc(50%+5rem)] -translate-x-1/2 bg-[#0d7377] text-white hover:bg-[#0b6467]"
                onClick={() => {
                  setComposing(true);
                  setError(null);
                }}
                type="button"
                variant="primary"
              >
                <Plus className="h-4 w-4" />
                New text
              </Button>
            </div>
          </main>
        )}
      </div>
    </section>
  );
}
