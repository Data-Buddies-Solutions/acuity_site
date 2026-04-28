import { redirect } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  Headphones,
  Mic2,
  PhoneForwarded,
  PhoneMissed,
  ShieldAlert,
  Voicemail,
} from "lucide-react";

import { Button } from "@/app/components/ui/button";
import { PracticeBrandLogo } from "@/app/portal/app/PracticeBrandLogo";
import { getPortalCallCenterData, resolveTelnyxRuntimeSettings } from "@/lib/call-center";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import {
  disableCallCenterAction,
  enableCallCenterAction,
  resolveMissedCallAction,
  resolveVoicemailAction,
} from "./actions";
import SoftphonePanel from "./SoftphonePanel";

export const dynamic = "force-dynamic";

function formatPhone(phone: string | null | undefined) {
  const digits = (phone || "").replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return phone || "Unknown";
}

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;

  return minutes > 0
    ? `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`
    : `${remainingSeconds}s`;
}

function formatTime(date: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
  }).format(new Date(date));
}

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof PhoneForwarded;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-black/8 bg-white px-4 py-4 shadow-[0_14px_40px_rgba(16,39,44,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6f8083]">
          {label}
        </p>
        <Icon className="h-4 w-4 text-[#0d7377]" aria-hidden="true" />
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
        {value}
      </p>
    </div>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-black/10 bg-white/70 px-4 py-8 text-center text-sm text-[#617477]">
      {label}
    </div>
  );
}

function MissedCallsPanel({
  missedCalls,
}: {
  missedCalls: NonNullable<
    Awaited<ReturnType<typeof getPortalCallCenterData>>
  >["missedCalls"];
}) {
  return (
    <section className="rounded-lg border border-black/8 bg-white shadow-[0_14px_40px_rgba(16,39,44,0.04)]">
      <div className="border-b border-black/8 px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6f8083]">
          Missed
        </p>
        <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-[#10272c]">
          Callback queue
        </h3>
      </div>
      {missedCalls.length ? (
        <div className="divide-y divide-black/6">
          {missedCalls.map((missedCall) => (
            <article key={missedCall.id} className="px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[#10272c]">
                    {missedCall.callerName || formatPhone(missedCall.fromPhone)}
                  </p>
                  <p className="mt-1 text-sm text-[#617477]">
                    {formatPhone(missedCall.fromPhone)}
                    {missedCall.location?.name ? ` · ${missedCall.location.name}` : ""}
                  </p>
                  <p className="mt-1 text-xs font-medium text-[#8a999b]">
                    {formatTime(missedCall.createdAt)}
                  </p>
                </div>
                <form action={resolveMissedCallAction}>
                  <input type="hidden" name="id" value={missedCall.id} />
                  <Button size="sm" variant="secondary">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Done
                  </Button>
                </form>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="p-4">
          <EmptyPanel label="No missed callbacks are open." />
        </div>
      )}
    </section>
  );
}

function VoicemailsPanel({
  voicemails,
}: {
  voicemails: NonNullable<
    Awaited<ReturnType<typeof getPortalCallCenterData>>
  >["voicemails"];
}) {
  return (
    <section className="rounded-lg border border-black/8 bg-white shadow-[0_14px_40px_rgba(16,39,44,0.04)]">
      <div className="border-b border-black/8 px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6f8083]">
          Voicemail
        </p>
        <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-[#10272c]">
          Messages
        </h3>
      </div>
      {voicemails.length ? (
        <div className="divide-y divide-black/6">
          {voicemails.map((voicemail) => (
            <article key={voicemail.id} className="space-y-3 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[#10272c]">
                    {voicemail.callerName || formatPhone(voicemail.fromPhone)}
                  </p>
                  <p className="mt-1 text-sm text-[#617477]">
                    {formatPhone(voicemail.fromPhone)} ·{" "}
                    {formatDuration(voicemail.durationSec)}
                  </p>
                  <p className="mt-1 text-xs font-medium text-[#8a999b]">
                    {formatTime(voicemail.createdAt)}
                  </p>
                </div>
                <form action={resolveVoicemailAction}>
                  <input type="hidden" name="id" value={voicemail.id} />
                  <Button size="sm" variant="secondary">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Done
                  </Button>
                </form>
              </div>
              <audio
                className="w-full"
                controls
                preload="none"
                src={`/api/portal/call-center/voicemails/${voicemail.recordingId}`}
              />
            </article>
          ))}
        </div>
      ) : (
        <div className="p-4">
          <EmptyPanel label="No voicemail messages are open." />
        </div>
      )}
    </section>
  );
}

export default async function PortalCallCenterPage() {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  const data = await getPortalCallCenterData();

  if (!data) {
    redirect("/portal");
  }

  const settings = data.settings;
  const enabled = settings?.enabled === true;
  const runtimeSettings = settings ? resolveTelnyxRuntimeSettings(settings) : null;
  const primaryNumber =
    runtimeSettings?.outboundCallerNumber ||
    data.phoneNumbers.find((phone) => phone.isPrimary)?.phoneNumber ||
    data.phoneNumbers[0]?.phoneNumber ||
    "";
  const configured = Boolean(
    enabled &&
    runtimeSettings?.connectionId &&
    runtimeSettings.credentialId &&
    primaryNumber,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="flex flex-col gap-4 border-b border-black/8 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <PracticeBrandLogo branding={data.branding} practiceName={data.practiceName} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f8083]">
              Call Center
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[#10272c] md:text-4xl">
              {data.practiceName}
            </h2>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form action={enabled ? disableCallCenterAction : enableCallCenterAction}>
            <Button variant={enabled ? "secondary" : "primary"}>
              {enabled ? "Disable" : "Enable"}
            </Button>
          </form>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <StatTile
          icon={PhoneForwarded}
          label="Active"
          value={data.totals.activeSessions}
        />
        <StatTile icon={PhoneMissed} label="Missed" value={data.totals.missedCalls} />
        <StatTile icon={Voicemail} label="Voicemail" value={data.totals.voicemails} />
      </section>

      {!enabled ? (
        <section className="rounded-lg border border-black/8 bg-white px-5 py-5 shadow-[0_14px_40px_rgba(16,39,44,0.04)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Headphones className="h-5 w-5 text-[#0d7377]" aria-hidden="true" />
                <h3 className="text-lg font-semibold tracking-[-0.03em] text-[#10272c]">
                  Call center is off
                </h3>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#617477]">
                Enable it for this practice to expose the browser phone, callback queue,
                voicemail inbox, and Telnyx webhook storage.
              </p>
            </div>
            <form action={enableCallCenterAction}>
              <Button variant="primary">
                <Mic2 className="h-4 w-4" aria-hidden="true" />
                Enable
              </Button>
            </form>
          </div>
        </section>
      ) : null}

      {enabled && !configured ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900">
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold">Telnyx setup is incomplete</h3>
              <p className="mt-1 text-sm leading-relaxed">
                Missing connection ID, credential ID, or caller number. Set practice
                settings or the matching Telnyx environment variables before staff can
                place calls.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {enabled && configured ? (
          <SoftphonePanel callerNumber={primaryNumber} enabled={enabled} />
        ) : (
          <section className="rounded-lg border border-black/8 bg-white p-5 shadow-[0_14px_40px_rgba(16,39,44,0.04)]">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-[#0d7377]" aria-hidden="true" />
              <h3 className="text-lg font-semibold tracking-[-0.03em] text-[#10272c]">
                Softphone standby
              </h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[#617477]">
              Calling becomes active after Telnyx is configured.
            </p>
          </section>
        )}
        <MissedCallsPanel missedCalls={data.missedCalls} />
        <VoicemailsPanel voicemails={data.voicemails} />
      </section>
    </div>
  );
}
