"use client";

import { Phone, PhoneIncoming, PhoneOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CallView } from "@/lib/call-center/realtime-contract";
import { formatPhone } from "@/lib/format";

import { callCounterpartyPhone } from "./canonical-call-presentation";

export function IncomingCallHeadsUp({
  canRespond = true,
  call,
  onAnswer,
  onDecline,
  pending,
  queueName,
}: {
  canRespond?: boolean;
  call: CallView;
  onAnswer: () => void;
  onDecline: () => void;
  pending: "answer" | "decline" | null;
  queueName: string;
}) {
  const phone = formatPhone(callCounterpartyPhone(call));
  const caller = call.callerName || phone;

  return (
    <section
      aria-label="Incoming call"
      className="rounded-2xl border border-[var(--portal-accent)]/30 bg-white p-4 shadow-[0_18px_50px_rgba(16,39,44,0.16)]"
      role="region"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]"
        >
          <PhoneIncoming className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--portal-accent)]">
            Incoming call
          </p>
          <p className="mt-1 truncate text-base font-semibold text-[var(--portal-ink)]">
            {caller}
          </p>
          <p className="mt-0.5 text-xs text-[var(--portal-muted)]">
            {call.callerName ? `${phone} · ` : ""}
            {queueName} queue
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          disabled={!canRespond || pending !== null}
          onClick={onAnswer}
          size="lg"
          variant="primary"
        >
          <Phone className="size-4" aria-hidden="true" />
          {pending === "answer" ? "Connecting…" : "Answer"}
        </Button>
        <Button
          disabled={!canRespond || pending !== null}
          onClick={onDecline}
          size="lg"
          variant="destructive"
        >
          <PhoneOff className="size-4" aria-hidden="true" />
          {pending === "decline" ? "Declining…" : "Decline"}
        </Button>
      </div>
      {canRespond ? (
        <p className="mt-2 text-xs leading-relaxed text-[var(--portal-muted)]">
          Decline means you will not answer this call. It does not end the caller’s call.
        </p>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-[var(--portal-warning)]">
          Calling is not ready yet. Answer and Decline will be available when it is.
        </p>
      )}
    </section>
  );
}
