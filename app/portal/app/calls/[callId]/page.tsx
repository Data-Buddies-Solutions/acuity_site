import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  getPortalCallTranscript,
  type PortalCallTranscriptMessage,
} from "@/lib/portal-overview";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

import { PracticePageHeader } from "../../PracticePageHeader";

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

function PortalTranscriptTimeline({
  messages,
}: {
  messages: PortalCallTranscriptMessage[];
}) {
  return (
    <div className="space-y-3">
      {messages.map((message, index) => {
        const isCaller = message.role === "caller";
        const timestamp = formatMessageTime(message.timestamp);

        return (
          <div
            key={`${message.role}-${index}`}
            className={cn("flex", isCaller ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-full rounded-2xl px-4 py-2.5 sm:max-w-[80%]",
                isCaller
                  ? "rounded-br-md bg-[#10272c] text-white"
                  : "rounded-bl-md bg-[#f1f5f5] text-[#10272c]",
              )}
            >
              <div
                className={cn(
                  "mb-1 flex items-center gap-2 text-[10px] font-medium",
                  isCaller ? "text-white/70" : "text-[#617477]",
                )}
              >
                <span>{isCaller ? "Caller" : "Acuity"}</span>
                {timestamp ? <span>{timestamp}</span> : null}
              </div>
              <p className="text-sm leading-relaxed">{message.text}</p>
            </div>
          </div>
        );
      })}
    </div>
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
    <div className="mx-auto max-w-4xl space-y-6">
      <PracticePageHeader
        branding={transcript.branding}
        logoMeta={dateFormatter.format(transcript.startedAt)}
        practiceName={transcript.practiceName}
        title={`Transcript · ${formatPhone(transcript.callerPhone)}`}
      >
        <Link
          className="inline-flex items-center rounded-md border border-black/8 bg-white px-3 py-1.5 text-sm font-medium text-[#10272c] transition hover:bg-[#f1f5f5]"
          href="/portal/app/bookings"
        >
          Back to Bookings
        </Link>
      </PracticePageHeader>

      <section className="rounded-xl border border-black/6 bg-white p-5 shadow-sm sm:p-6">
        {transcript.messages.length > 0 ? (
          <PortalTranscriptTimeline messages={transcript.messages} />
        ) : (
          <p className="text-sm text-[#617477]">
            No transcript is available for this call yet.
          </p>
        )}
      </section>
    </div>
  );
}
