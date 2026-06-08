import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  getPortalCallTranscript,
  type PortalCallTranscript,
  type PortalCallTranscriptMessage,
} from "@/lib/portal-overview";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { formatEasternAppointmentDateTime, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
});

const messageTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
});

function formatMessageTime(timestamp: number | null) {
  if (!timestamp) {
    return null;
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : messageTimeFormatter.format(date);
}

function formatDuration(seconds: number | null) {
  if (seconds == null || seconds <= 0) {
    return "Unknown";
  }

  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;

  if (minutes <= 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
}

function TranscriptHeader() {
  return (
    <section className="space-y-4 border-b border-[var(--portal-border)] pb-4">
      <Link
        className="inline-flex h-10 w-fit items-center gap-2 rounded-lg border border-[var(--portal-border)] bg-white px-3 text-sm font-medium text-[var(--portal-ink)] transition hover:bg-[var(--portal-panel)]"
        href="/portal/app/bookings"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Bookings
      </Link>
      <h1 className="text-3xl font-semibold leading-tight tracking-normal text-[var(--portal-ink)]">
        Transcript
      </h1>
    </section>
  );
}

function AppointmentContextCard({ transcript }: { transcript: PortalCallTranscript }) {
  const appointment = transcript.bookedAppointment;

  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <section className="rounded-xl border border-[var(--portal-border-strong)] bg-white p-4 shadow-sm">
        <div className="min-w-0 border-b border-[var(--portal-border)] pb-4">
          <p className="text-xs font-semibold uppercase tracking-normal text-[var(--portal-muted-soft)]">
            Patient
          </p>
          <p className="mt-1 truncate text-lg font-semibold text-[var(--portal-ink)]">
            {appointment?.patientName ?? "Unknown patient"}
          </p>
          <p className="mt-1 text-sm text-[var(--portal-muted)]">
            {formatPhone(transcript.callerPhone)}
          </p>
        </div>

        <div className="mt-4 grid gap-2">
          <DetailPill
            label="Doctor"
            value={appointment?.providerName ?? "Not detected"}
          />
          <DetailPill
            label="Appointment"
            value={formatEasternAppointmentDateTime(
              appointment?.appointmentStart ?? null,
              "Not detected",
            )}
          />
          <DetailPill
            label="Call time"
            value={dateFormatter.format(transcript.startedAt)}
          />
          <DetailPill label="Duration" value={formatDuration(transcript.durationSec)} />
        </div>
      </section>
    </aside>
  );
}

function DetailPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--portal-muted-soft)]">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold leading-5 text-[var(--portal-ink)]">
        {value}
      </p>
    </div>
  );
}

function PortalTranscriptTimeline({
  messages,
}: {
  messages: PortalCallTranscriptMessage[];
}) {
  return (
    <ol className="space-y-2.5 p-4 md:p-5">
      {messages.map((message, index) => {
        const isCaller = message.role === "caller";
        const timestamp = formatMessageTime(message.timestamp);

        return (
          <li
            key={`${message.role}-${index}`}
            className={cn("flex", isCaller ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "flex max-w-[92%] flex-col sm:max-w-[78%]",
                isCaller ? "items-end" : "items-start",
              )}
            >
              <div
                className={cn(
                  "mb-1 flex items-center gap-2 px-1 text-[11px] font-semibold",
                  isCaller
                    ? "justify-end text-[var(--portal-accent)]"
                    : "text-[var(--portal-muted-soft)]",
                )}
              >
                <span>{isCaller ? "Caller" : "Acuity"}</span>
                {timestamp ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{timestamp}</span>
                  </>
                ) : null}
              </div>
              <div
                className={cn(
                  "rounded-2xl px-4 py-3 shadow-sm",
                  isCaller
                    ? "min-w-24 rounded-br-md border border-[#536a91] bg-[#536a91] text-white"
                    : "rounded-bl-md border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] text-[var(--portal-ink)]",
                )}
              >
                <p
                  className={cn(
                    "text-sm leading-6",
                    isCaller ? "!text-white" : "text-[var(--portal-ink)]",
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
  );
}

function ConversationPanel({ messages }: { messages: PortalCallTranscriptMessage[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--portal-border-strong)] bg-white shadow-sm">
      {messages.length > 0 ? (
        <PortalTranscriptTimeline messages={messages} />
      ) : (
        <p className="px-5 py-10 text-sm text-[var(--portal-muted)]">
          No transcript is available for this call yet.
        </p>
      )}
    </section>
  );
}

export default async function PortalCallTranscriptPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  const { callId } = await params;
  const transcript = await getPortalCallTranscript(callId);

  if (!transcript) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <TranscriptHeader />
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <AppointmentContextCard transcript={transcript} />
        <ConversationPanel messages={transcript.messages} />
      </div>
    </div>
  );
}
