"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  CheckCheck,
  Circle,
  Loader2,
  Lock,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { EASTERN_TIME_ZONE } from "@/lib/format";
import { cn } from "@/lib/utils";

type SmsConversationStatus = "OPEN" | "CLOSED";
type ConversationFilter = SmsConversationStatus | "UNREAD";
type SmsMessageDirection = "INBOUND" | "OUTBOUND";
type SmsMessageStatus =
  "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "FAILED" | "RECEIVED";

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
  timeZone: EASTERN_TIME_ZONE,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: EASTERN_TIME_ZONE,
});

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: EASTERN_TIME_ZONE,
  year: "numeric",
});

function formatMessageTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const sameDay = dayKeyFormatter.format(date) === dayKeyFormatter.format(new Date());

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

function conversationStatusLabel(status: SmsConversationStatus) {
  return status === "OPEN" ? "Open" : "Done";
}

function filterEmptyLabel(filter: ConversationFilter) {
  if (filter === "UNREAD") {
    return "unread";
  }

  return filter === "CLOSED" ? "done" : "open";
}

function conversationMatchesFilter(
  conversation: ConversationListItem,
  filter: ConversationFilter,
) {
  return filter === "UNREAD" ? conversation.unread : conversation.status === filter;
}

function firstConversationIdForFilter(
  conversations: ConversationListItem[],
  filter: ConversationFilter,
) {
  return conversations.find((conversation) =>
    conversationMatchesFilter(conversation, filter),
  )?.id;
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
    <div className="flex h-full min-h-72 flex-col items-center justify-center border-l border-[var(--portal-border)] bg-white px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]">
        <MessageSquareText className="h-7 w-7" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-[var(--portal-ink)]">
        No conversation selected
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--portal-muted)]">
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
            ? "rounded-br-sm border border-[#536a91] bg-[#536a91] text-white"
            : "rounded-bl-md border border-[var(--portal-border)] bg-white text-[var(--portal-ink)]",
          failed && "bg-[#fff1f1] text-[#8a1f1f]",
        )}
      >
        <p
          className={cn(
            "whitespace-pre-wrap text-sm leading-5",
            outbound && !failed ? "!text-white" : "text-[var(--portal-ink)]",
            failed && "text-[#8a1f1f]",
          )}
        >
          {message.body}
        </p>
        <div
          className={cn(
            "mt-1.5 flex items-center gap-2 text-[11px]",
            outbound && !failed ? "text-white/80" : "text-[var(--portal-muted-soft)]",
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
        selected
          ? "bg-[#edf4ff] shadow-[inset_3px_0_0_#536a91]"
          : "bg-white hover:bg-[#f6f9ff]",
      )}
      onClick={() => onSelect(conversation.id)}
    >
      <span
        className={cn(
          "mt-1 h-2.5 w-2.5 rounded-full",
          conversation.unread
            ? "bg-[#536a91]"
            : "bg-transparent ring-1 ring-[var(--portal-border-strong)]",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-semibold text-[var(--portal-ink)]">
            {conversation.patientPhoneNumberDisplay}
          </span>
          <span className="shrink-0 text-xs text-[var(--portal-muted-soft)]">
            {formatMessageTime(conversation.lastMessageAt)}
          </span>
        </span>
        <span className="mt-1 block truncate text-sm text-[var(--portal-muted)]">
          {conversation.lastMessageDirection === "OUTBOUND" ? "You: " : ""}
          {conversation.lastMessagePreview || "No message body"}
        </span>
        <span className="mt-2 flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold",
              conversation.status === "OPEN"
                ? "bg-[#edf4ff] text-[#536a91]"
                : "bg-[#f2f4f7] text-[var(--portal-muted)]",
            )}
          >
            {conversationStatusLabel(conversation.status)}
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
    <div className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 bg-[#edf4ff] px-4 py-4 text-left shadow-[inset_3px_0_0_#536a91] transition">
      <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#536a91]" aria-hidden="true" />
      <span className="min-w-0">
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-semibold text-[var(--portal-ink)]">
            {phone.trim() || "New text"}
          </span>
          <span className="shrink-0 text-xs text-[var(--portal-muted-soft)]">Draft</span>
        </span>
        <span className="mt-1 block truncate text-sm text-[var(--portal-muted)]">
          {body.trim() || "Write the first message"}
        </span>
        <span className="mt-2 flex items-center gap-2">
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#536a91]">
            New
          </span>
        </span>
      </span>
    </div>
  );
}

function DeleteConversationDialog({
  deleting,
  onCancel,
  onDelete,
  phoneNumber,
}: {
  deleting: boolean;
  onCancel: () => void;
  onDelete: () => void;
  phoneNumber: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    cancelButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (!focusableElements.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0]!;
      const lastElement = focusableElements[focusableElements.length - 1]!;

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [deleting, onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#151a24]/35 px-4">
      <div
        aria-describedby="delete-conversation-description"
        aria-labelledby="delete-conversation-title"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-[var(--portal-border)] bg-white p-5 shadow-[0_24px_80px_rgba(16,24,40,0.18)]"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--portal-danger-soft)] text-[var(--portal-danger)]">
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2
              className="text-base font-semibold text-[var(--portal-ink)]"
              id="delete-conversation-title"
            >
              Delete conversation permanently?
            </h2>
            <p
              className="mt-2 text-sm leading-6 text-[var(--portal-muted)]"
              id="delete-conversation-description"
            >
              Marking done keeps the thread for reference. Delete permanently removes the
              done thread for {phoneNumber} from this inbox.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            className="bg-white"
            disabled={deleting}
            onClick={onCancel}
            ref={cancelButtonRef}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            className="bg-[var(--portal-danger)] text-white hover:bg-[#9f1f17]"
            disabled={deleting}
            onClick={onDelete}
            type="button"
            variant="primary"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Delete permanently
          </Button>
        </div>
      </div>
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
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--portal-panel-soft)]">
      <header className="border-b border-[var(--portal-border)] bg-white px-4 py-3 md:px-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <label className="sr-only" htmlFor="new-sms-phone">
              Patient mobile
            </label>
            <div className="grid max-w-md grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border-b border-[var(--portal-border-strong)] pb-1.5 transition focus-within:border-[#536a91]">
              <span className="text-sm font-semibold text-[var(--portal-muted-soft)]">
                To
              </span>
              <input
                autoComplete="tel"
                className="h-7 w-full min-w-0 bg-transparent text-sm font-semibold text-[var(--portal-ink)] outline-none placeholder:font-medium placeholder:text-[var(--portal-muted-soft)]"
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
            className="h-9 w-9 border-[var(--portal-border)] bg-white p-0 text-[var(--portal-muted)] hover:bg-[var(--portal-panel)]"
            onClick={onCancel}
            type="button"
            variant="secondary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      {error ? (
        <div className="border-b border-[#ffd6d6] bg-[var(--portal-danger-soft)] px-4 py-2 text-sm text-[var(--portal-danger)]">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-5">
        <div className="grid min-h-[360px] place-items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]">
            <MessageSquareText className="h-7 w-7" aria-hidden="true" />
          </div>
        </div>
      </div>

      <footer className="border-t border-[var(--portal-border)] bg-white px-4 py-3 md:px-5">
        <form onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="new-sms-body">
            Message
          </label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <textarea
              className="max-h-32 min-h-11 resize-y rounded-xl border border-[var(--portal-border-strong)] bg-white px-3 py-2.5 text-sm leading-5 text-[var(--portal-ink)] shadow-sm outline-none transition placeholder:text-[var(--portal-muted-soft)] focus:border-[#536a91] focus:ring-2 focus:ring-[#536a91]/15"
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
              rows={1}
              value={body}
            />
            <Button
              className="h-11 bg-[#536a91] px-4 text-white hover:bg-[#435879]"
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
          <div className="mt-1 flex justify-end text-[11px] font-medium text-[var(--portal-muted-soft)]">
            {body.length}/1000
          </div>
        </form>
      </footer>
    </main>
  );
}
export default function TwoWayTextingWorkspace({
  initialConversation,
  initialFilter,
  initialInbox,
  initialSearchQuery,
  initialSelectedConversationId,
}: {
  initialConversation: ConversationDetail | null;
  initialFilter: ConversationFilter;
  initialInbox: InboxState;
  initialSearchQuery: string;
  initialSelectedConversationId: string;
}) {
  const [inbox, setInbox] = useState(initialInbox);
  const [filter, setFilter] = useState<ConversationFilter>(initialFilter);
  const [selectedId, setSelectedId] = useState(
    () =>
      initialSelectedConversationId ||
      initialConversation?.id ||
      firstConversationIdForFilter(initialInbox.conversations, initialFilter) ||
      "",
  );
  const [conversation, setConversation] = useState<ConversationDetail | null>(
    initialConversation,
  );
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [draft, setDraft] = useState("");
  const [newPatientPhone, setNewPatientPhone] = useState("");
  const [newDraft, setNewDraft] = useState("");
  const [composing, setComposing] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [startingOutbound, setStartingOutbound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filterRef = useRef(initialFilter);
  const initialConversationIdRef = useRef(initialConversation?.id ?? "");
  const searchMountedRef = useRef(false);

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

  const selectFilter = useCallback(
    (nextFilter: ConversationFilter) => {
      setFilter(nextFilter);
      setSelectedId((currentId) => {
        const currentConversation = inbox.conversations.find(
          (item) => item.id === currentId,
        );

        if (
          currentConversation &&
          conversationMatchesFilter(currentConversation, nextFilter)
        ) {
          return currentId;
        }

        return firstConversationIdForFilter(inbox.conversations, nextFilter) ?? "";
      });
    },
    [inbox.conversations],
  );

  const conversationListQuery = useCallback(() => {
    const params = new URLSearchParams();

    if (inbox.selectedInboxId) {
      params.set("inboxId", inbox.selectedInboxId);
    }

    if (searchQuery.trim()) {
      params.set("search", searchQuery.trim());
    }

    const query = params.toString();
    return query ? `?${query}` : "";
  }, [inbox.selectedInboxId, searchQuery]);

  const refreshInbox = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) {
        setRefreshing(true);
      }

      try {
        const next = await fetch(
          `/api/portal/sms/conversations${conversationListQuery()}`,
          {
            cache: "no-store",
          },
        ).then((response) => readJson<InboxState>(response));
        setInbox(next);
        setError(null);

        const fallbackSelectedId =
          firstConversationIdForFilter(next.conversations, filterRef.current) ?? "";

        if (selectedId && !next.conversations.some((item) => item.id === selectedId)) {
          setSelectedId(fallbackSelectedId);
          setConversation(null);
        } else if (!selectedId && fallbackSelectedId) {
          setSelectedId(fallbackSelectedId);
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
    [conversationListQuery, selectedId],
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
    filterRef.current = filter;
  }, [filter]);

  useEffect(() => {
    if (initialConversationIdRef.current === selectedId) {
      initialConversationIdRef.current = "";
      setDeleteConfirmOpen(false);
      return;
    }

    initialConversationIdRef.current = "";
    void refreshConversation();
    setDeleteConfirmOpen(false);
  }, [refreshConversation, selectedId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (inbox.selectedInboxId) {
      params.set("inbox", inbox.selectedInboxId);
    } else {
      params.delete("inbox");
    }

    if (selectedId) {
      params.set("conversation", selectedId);
    } else {
      params.delete("conversation");
    }

    if (filter === "OPEN") {
      params.delete("filter");
    } else {
      params.set("filter", filter);
    }

    const trimmedSearch = searchQuery.trim();
    if (trimmedSearch) {
      params.set("search", trimmedSearch);
    } else {
      params.delete("search");
    }

    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextUrl !== currentUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [filter, inbox.selectedInboxId, searchQuery, selectedId]);

  useEffect(() => {
    if (!searchMountedRef.current) {
      searchMountedRef.current = true;
      return;
    }

    const handle = setTimeout(() => {
      void refreshInbox({ quiet: true });
    }, 300);

    return () => clearTimeout(handle);
  }, [refreshInbox, searchQuery]);

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
      setSearchQuery("");
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

    setDeleting(true);
    setError(null);

    try {
      await fetch(`/api/portal/sms/conversations/${conversation.id}`, {
        method: "DELETE",
      }).then((response) => readJson<{ ok: boolean }>(response));

      const next = await fetch(
        `/api/portal/sms/conversations${conversationListQuery()}`,
        {
          cache: "no-store",
        },
      ).then((response) => readJson<InboxState>(response));

      setInbox(next);
      setSelectedId(firstConversationIdForFilter(next.conversations, filter) ?? "");
      setConversation(null);
      setDeleteConfirmOpen(false);
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

  const trimmedSearch = searchQuery.trim();

  if (!inbox.configured) {
    return (
      <section className="grid min-h-[560px] place-items-center rounded-xl border border-[var(--portal-border-strong)] bg-white px-6 py-16 text-center shadow-sm">
        <div className="max-w-lg">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff6db] text-[#8a6500]">
            <AlertCircle className="h-7 w-7" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-xl font-semibold text-[var(--portal-ink)]">
            Texting is not linked yet
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--portal-muted)]">
            This login does not have an assigned texting number. Add the practice phone
            number for the correct location, then send a test SMS to confirm Telnyx
            webhooks are creating conversations.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="grid h-[calc(100vh-190px)] min-h-[560px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-[var(--portal-border-strong)] bg-white shadow-sm">
      <div className="border-b border-[var(--portal-border)] bg-white px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-normal text-[var(--portal-muted-soft)]">
              Status
            </p>
            <div className="inline-flex w-full rounded-lg border border-[var(--portal-border)] bg-white p-1 sm:w-fit">
              {[
                ["OPEN", "Open"],
                ["UNREAD", "Unread"],
                ["CLOSED", "Done"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    "flex-1 rounded-md px-4 py-1.5 text-center text-sm font-medium transition sm:min-w-24",
                    filter === value
                      ? "!bg-[#536a91] !text-white shadow-sm hover:!text-white"
                      : "text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]",
                  )}
                  onClick={() => selectFilter(value as ConversationFilter)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-10 bg-[#536a91] text-white hover:bg-[#435879]"
              onClick={() => {
                setComposing(true);
                setSelectedId("");
                setConversation(null);
                setDeleteConfirmOpen(false);
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
              className="h-10 border-[var(--portal-border)] bg-white text-[var(--portal-ink)] hover:bg-[var(--portal-panel)]"
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
        <aside className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] border-b border-[var(--portal-border)] md:border-b-0 md:border-r">
          <div className="border-b border-[var(--portal-border)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-normal text-[var(--portal-muted-soft)]">
                Conversations
              </p>
              <span className="rounded-full bg-[#edf4ff] px-2.5 py-1 text-xs font-semibold text-[#536a91]">
                {inbox.unreadCount} unread
              </span>
            </div>
            <label className="sr-only" htmlFor="sms-conversation-search">
              Search by phone number
            </label>
            <div className="relative mt-3">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--portal-muted-soft)]"
                aria-hidden="true"
              />
              <input
                className="h-11 w-full rounded-xl border border-[var(--portal-border-strong)] bg-white px-9 text-sm text-[var(--portal-ink)] shadow-sm outline-none transition placeholder:text-[var(--portal-muted-soft)] focus:border-[#536a91] focus:ring-2 focus:ring-[#536a91]/15"
                id="sms-conversation-search"
                inputMode="tel"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by number"
                type="search"
                value={searchQuery}
              />
              {searchQuery ? (
                <button
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[var(--portal-muted)] transition hover:bg-[#edf4ff] hover:text-[#536a91]"
                  onClick={() => setSearchQuery("")}
                  type="button"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="min-h-0 divide-y divide-[var(--portal-border)] overflow-y-auto">
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
                <p className="mt-3 text-sm font-medium text-[var(--portal-ink)]">
                  {trimmedSearch
                    ? "No matching conversations"
                    : `No ${filterEmptyLabel(filter)} conversations`}
                </p>
                <p className="mt-1 text-sm leading-6 text-[var(--portal-muted)]">
                  {trimmedSearch
                    ? "Try another phone number."
                    : "Texts to this inbox will appear here."}
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
          <main className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--portal-panel-soft)]">
            {error ? (
              <div className="border-b border-[#ffd6d6] bg-[var(--portal-danger-soft)] px-4 py-2 text-sm text-[var(--portal-danger)]">
                {error}
              </div>
            ) : null}
            <header className="border-b border-[var(--portal-border)] bg-white px-4 py-3 md:px-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-normal text-[var(--portal-muted-soft)]">
                    Text thread
                  </p>
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
                    <p className="truncate text-base font-semibold text-[var(--portal-ink)] md:text-lg">
                      {selectedConversation.patientPhoneNumberDisplay}
                    </p>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-semibold",
                        selectedConversation.status === "OPEN"
                          ? "bg-[#edf4ff] text-[#536a91]"
                          : "bg-[#f2f4f7] text-[var(--portal-muted)]",
                      )}
                    >
                      {conversationStatusLabel(selectedConversation.status)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedConversation.status === "CLOSED" ? (
                    <Button
                      className="border-[#ffd6d6] bg-white text-[#8a1f1f] hover:bg-[#fff7f7]"
                      disabled={deleting}
                      onClick={() => setDeleteConfirmOpen(true)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {deleting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Delete permanently
                    </Button>
                  ) : null}
                  <Button
                    className="border-[var(--portal-border)] bg-white text-[var(--portal-ink)] hover:bg-[var(--portal-panel)]"
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
                    {selectedConversation.status === "OPEN" ? "Mark done" : "Reopen"}
                  </Button>
                </div>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
              {loadingThread ? (
                <div className="grid min-h-[360px] place-items-center text-[var(--portal-muted)]">
                  <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" />
                </div>
              ) : conversation?.messages.length ? (
                <div className="space-y-2.5">
                  {conversation.messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                </div>
              ) : (
                <div className="grid min-h-[360px] place-items-center text-sm text-[var(--portal-muted)]">
                  No messages loaded.
                </div>
              )}
            </div>

            <footer className="border-t border-[var(--portal-border)] bg-white px-4 py-3 md:px-5">
              {conversation?.optedOut ? (
                <div className="mb-3 flex items-center gap-2 rounded-lg bg-[var(--portal-danger-soft)] px-3 py-2 text-sm text-[var(--portal-danger)]">
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  This patient opted out. Replies are blocked.
                </div>
              ) : null}
              <form onSubmit={handleSend}>
                <label className="sr-only" htmlFor="sms-reply">
                  Reply
                </label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <textarea
                    className="max-h-32 min-h-11 resize-y rounded-xl border border-[var(--portal-border-strong)] bg-white px-3 py-2.5 text-sm leading-5 text-[var(--portal-ink)] shadow-sm outline-none transition placeholder:text-[var(--portal-muted-soft)] focus:border-[#536a91] focus:ring-2 focus:ring-[#536a91]/15"
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
                    rows={1}
                    value={draft}
                  />
                  <Button
                    className="h-11 bg-[#536a91] px-4 text-white hover:bg-[#435879]"
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
                <div className="mt-1 flex justify-end text-[11px] font-medium text-[var(--portal-muted-soft)]">
                  {draft.length}/1000
                </div>
              </form>
            </footer>
            {deleteConfirmOpen ? (
              <DeleteConversationDialog
                deleting={deleting}
                onCancel={() => setDeleteConfirmOpen(false)}
                onDelete={() => void handleDelete()}
                phoneNumber={selectedConversation.patientPhoneNumberDisplay}
              />
            ) : null}
          </main>
        ) : (
          <main className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
            {error ? (
              <div className="border-b border-[#ffd6d6] bg-[var(--portal-danger-soft)] px-4 py-2 text-sm text-[var(--portal-danger)]">
                {error}
              </div>
            ) : null}
            <div className="relative min-h-0 flex-1">
              <EmptyThread />
              <Button
                className="absolute left-1/2 top-[calc(50%+5rem)] -translate-x-1/2 bg-[#536a91] text-white hover:bg-[#435879]"
                onClick={() => {
                  setComposing(true);
                  setSelectedId("");
                  setConversation(null);
                  setDeleteConfirmOpen(false);
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
