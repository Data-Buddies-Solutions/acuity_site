import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  SessionTranscriptTimeline,
  TranscriptTimeline,
} from "@/app/components/turn-bubble";
import { getPortalCallTranscript } from "@/lib/portal-overview";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { formatPhone } from "@/lib/format";

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

  const hasSession = transcript.sessionItems.length > 0;
  const hasTurns = transcript.turns.length > 0;

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
        {hasSession ? (
          <SessionTranscriptTimeline items={transcript.sessionItems} />
        ) : hasTurns ? (
          <TranscriptTimeline turns={transcript.turns} />
        ) : (
          <p className="text-sm text-[#617477]">
            No transcript is available for this call yet.
          </p>
        )}
      </section>
    </div>
  );
}
