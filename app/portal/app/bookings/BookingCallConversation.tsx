"use client";

import { MessageSquareText, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { BookingCallDetails } from "./actions";

const messageTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
});

function formatMessageTime(timestamp: number | null) {
  if (!timestamp) return null;

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : messageTimeFormatter.format(date);
}

function ConversationSkeleton() {
  return (
    <div aria-label="Loading conversation" className="space-y-4 p-4" role="status">
      {["left", "right", "left", "right"].map((side, index) => (
        <div
          className={cn("flex", side === "right" && "justify-end")}
          key={`${side}-${index}`}
        >
          <div className="w-[76%] space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className={cn("h-14 rounded-2xl", index === 2 && "h-20")} />
          </div>
        </div>
      ))}
    </div>
  );
}

function emptyConversationMessage(details: BookingCallDetails) {
  if (details.completeness.status === "in_progress") {
    return "This call is still processing. The conversation will appear when it is ready.";
  }

  return (
    details.completeness.description ?? "No conversation is available for this call yet."
  );
}

export function BookingCallConversation({
  details,
  error,
  isLoading,
  onRetry,
}: {
  details: BookingCallDetails | null;
  error: string | null;
  isLoading: boolean;
  onRetry: () => void;
}) {
  if (isLoading || (!details && !error)) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-[var(--portal-border)] bg-white">
        <ConversationSkeleton />
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="flex min-h-36 flex-1 flex-col items-center justify-center rounded-xl border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] px-5 py-7 text-center">
        <MessageSquareText
          aria-hidden="true"
          className="size-5 text-[var(--portal-muted)]"
        />
        <p className="mt-2 text-sm text-[var(--portal-muted)]">
          {error ?? "Call details are unavailable."}
        </p>
        <Button className="mt-4" onClick={onRetry} size="compact" variant="outline">
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }

  if (!details.messages.length) {
    return (
      <div className="flex min-h-36 flex-1 flex-col items-center justify-center rounded-xl border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] px-5 py-7 text-center">
        <MessageSquareText
          aria-hidden="true"
          className="size-5 text-[var(--portal-muted)]"
        />
        <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--portal-muted)]">
          {emptyConversationMessage(details)}
        </p>
      </div>
    );
  }

  return (
    <div
      aria-label="Call conversation"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-[var(--portal-border)] bg-white"
      data-testid="booking-conversation"
    >
      <ol className="space-y-3 p-3.5 sm:p-4">
        {details.messages.map((message, index) => {
          const isCaller = message.role === "caller";
          const timestamp = formatMessageTime(message.timestamp);

          return (
            <li
              className={cn("flex", isCaller ? "justify-end" : "justify-start")}
              key={`${message.role}-${message.timestamp ?? index}-${index}`}
            >
              <div
                className={cn(
                  "flex max-w-[88%] flex-col",
                  isCaller ? "items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold",
                    isCaller
                      ? "text-[var(--portal-accent)]"
                      : "text-[var(--portal-muted-soft)]",
                  )}
                >
                  <span>{isCaller ? "Caller" : "Acuity"}</span>
                  {timestamp ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <time>{timestamp}</time>
                    </>
                  ) : null}
                </div>
                <div
                  className={cn(
                    "rounded-2xl px-3.5 py-2.5 shadow-sm",
                    isCaller
                      ? "rounded-br-md bg-[var(--portal-accent)] text-white"
                      : "rounded-bl-md border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] text-[var(--portal-ink)]",
                  )}
                  data-role={message.role}
                >
                  <p
                    className={cn(
                      "whitespace-pre-wrap break-words text-sm font-medium leading-6",
                      isCaller ? "!text-white" : "!text-[var(--portal-ink)]",
                    )}
                  >
                    {message.text}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
