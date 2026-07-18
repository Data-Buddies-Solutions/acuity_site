"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Delete,
  Grid3X3,
  Headphones,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  Play,
} from "lucide-react";

import { PortalBadge } from "@/app/portal/app/PortalBadge";
import { PortalSelect } from "@/app/portal/app/PortalFields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { PortalNeedsActionGroup } from "@/lib/call-center/portal-model";
import type { CanonicalOutboundNumber } from "@/lib/call-center/application/portal-canonical-workspace";
import {
  selectIncomingCalls,
  type AgentSessionView,
  type CallView,
} from "@/lib/call-center/realtime-contract";
import { formatPhone } from "@/lib/format";

import {
  callCenterResponse,
  localCallCenterError,
  operatorErrorCopy,
  type CallCenterAction,
} from "./call-center-errors";
import { setCallCenterCurrentCallGuard } from "./call-center-current-call-guard";
import { canonicalTaskSignal } from "./canonical-task-signal";
import {
  canonicalOutboundIdempotencyKey,
  completeCanonicalOutboundOperation,
  selectCanonicalAgentActiveCall,
  selectCanonicalBrowserMediaLeg,
} from "./canonical-active-call-center";
import ActivityRail from "./ActivityRail";
import { CallCenterLeaveGuard } from "./CallCenterLeaveGuard";
import { callCounterpartyPhone } from "./canonical-call-presentation";
import { IncomingCallHeadsUp } from "./IncomingCallHeadsUp";
import { IncomingOfferAnnouncement } from "./IncomingOfferAnnouncement";
import type { CanonicalAgentConnectionState } from "./use-canonical-agent-session";
import { useCanonicalCallCenter } from "./use-canonical-call-center";
import { useSoftphoneMedia } from "./use-softphone";
import { useSoftphoneRuntime } from "../SoftphoneRuntime";

type CanonicalActiveWorkspaceProps = {
  followUpHref: string;
  historyHref: string;
  initialDialNumber?: string | null;
  needsAction: PortalNeedsActionGroup[];
  needsActionCount: number;
  office?: string | null;
  outboundNumbers: CanonicalOutboundNumber[];
  queueId: string | null;
};

const keypadDigits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const OUTBOUND_NUMBER_STORAGE_KEY = "acuity-call-center:outbound-number-id";
const RECENT_CALL_PREVIEW_LIMIT = 5;

function errorMessage(error: unknown, action: CallCenterAction) {
  return operatorErrorCopy(error, action).message;
}

function isAgentSessionViewReady(session: AgentSessionView) {
  return (
    session.presence === "AVAILABLE" &&
    session.connectionState === "READY" &&
    session.microphoneReady &&
    session.audioReady
  );
}

function isAgentSessionViewConnected(session: AgentSessionView) {
  return (
    session.presence !== "OFFLINE" &&
    !["DISCONNECTED", "FAILED"].includes(session.connectionState) &&
    session.microphoneReady &&
    session.audioReady
  );
}

export function CallConnectionStatus({
  restoring = false,
  session,
}: {
  restoring?: boolean;
  session: AgentSessionView | null;
}) {
  const connected = Boolean(
    !restoring && session && isAgentSessionViewConnected(session),
  );

  return (
    <PortalBadge
      className={
        restoring
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : connected
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-[var(--portal-border)] bg-[var(--portal-panel-soft)] text-[var(--portal-muted)]"
      }
      role="status"
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          restoring ? "bg-amber-500" : connected ? "bg-emerald-500" : "bg-slate-400"
        }`}
      />
      {restoring
        ? "Restoring calling…"
        : connected
          ? "Connected"
          : "Phone disconnected — reconnecting"}
    </PortalBadge>
  );
}

export function canonicalSessionConnectionState(
  connectionState: CanonicalAgentConnectionState,
  shouldConnect: boolean,
) {
  return shouldConnect && connectionState === "CLOSED"
    ? ("CONNECTING" as const)
    : connectionState;
}

function formatCallDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainingSeconds = (seconds % 60).toString().padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

export function CanonicalActiveWorkspace({
  followUpHref,
  historyHref,
  initialDialNumber,
  needsAction,
  needsActionCount,
  office,
  outboundNumbers,
  queueId,
}: CanonicalActiveWorkspaceProps) {
  const runtime = useSoftphoneRuntime();

  if (!queueId) {
    return (
      <CanonicalUnavailable message="Calling is not configured for this location." />
    );
  }
  if (runtime.error && !runtime.clientInstanceId) {
    return <CanonicalUnavailable message={runtime.error} />;
  }
  if (!runtime.clientInstanceId) {
    return <CanonicalUnavailable message="Connecting to the call center…" />;
  }

  return (
    <ConnectedCanonicalActiveWorkspace
      clientInstanceId={runtime.clientInstanceId}
      followUpHref={followUpHref}
      historyHref={historyHref}
      initialDialNumber={initialDialNumber}
      needsAction={needsAction}
      needsActionCount={needsActionCount}
      office={office}
      outboundNumbers={outboundNumbers}
      queueId={queueId}
    />
  );
}

function ConnectedCanonicalActiveWorkspace({
  clientInstanceId,
  followUpHref,
  historyHref,
  initialDialNumber,
  needsAction,
  needsActionCount,
  office,
  outboundNumbers,
  queueId,
}: {
  clientInstanceId: string;
  followUpHref: string;
  historyHref: string;
  initialDialNumber?: string | null;
  needsAction: PortalNeedsActionGroup[];
  needsActionCount: number;
  office?: string | null;
  outboundNumbers: CanonicalOutboundNumber[];
  queueId: string;
}) {
  const router = useRouter();
  const runtime = useSoftphoneRuntime();
  const realtime = useCanonicalCallCenter({ clientInstanceId, queueId });
  const refreshSnapshot = realtime.refetch;
  const [actionError, setActionError] = useState<string | null>(null);
  const [destination, setDestination] = useState(initialDialNumber ?? "");
  const [decliningMediaLegId, setDecliningMediaLegId] = useState<string | null>(null);
  const [numberChoice, setNumberChoice] = useState("");
  const [startingOutbound, setStartingOutbound] = useState(false);
  const outboundMediaLegsRef = useRef(new Set<string>());
  const outboundStartingRef = useRef(false);
  const taskSignalRef = useRef<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        setNumberChoice(window.localStorage.getItem(OUTBOUND_NUMBER_STORAGE_KEY) ?? "");
      } catch {
        // Storage is a convenience; server authorization remains authoritative.
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const agentProfileId = realtime.state?.agentProfile?.id ?? "";
  const eligibleOutboundNumbers = outboundNumbers;
  const selectedNumberId = eligibleOutboundNumbers.some(({ id }) => id === numberChoice)
    ? numberChoice
    : (eligibleOutboundNumbers[0]?.id ?? "");
  const selectedOutboundNumber = eligibleOutboundNumbers.find(
    ({ id }) => id === selectedNumberId,
  );
  const state = realtime.state;
  const taskSignal = state
    ? canonicalTaskSignal(state.counts.openTasks, state.tasks)
    : undefined;
  const session = runtime.session;
  const media = runtime.media;
  const {
    activate: activateMedia,
    dial: dialMediaLeg,
    observations: mediaObservations,
  } = media;

  useEffect(() => {
    if (taskSignal === undefined) return;
    if (taskSignalRef.current === null) {
      taskSignalRef.current = taskSignal;
      router.refresh();
      return;
    }
    if (taskSignalRef.current !== taskSignal) {
      taskSignalRef.current = taskSignal;
      router.refresh();
    }
  }, [router, taskSignal]);

  const incomingCalls = useMemo(() => (state ? selectIncomingCalls(state) : []), [state]);
  const activeCall = selectCanonicalAgentActiveCall(state?.calls ?? [], session);
  const headsUpOffer = useMemo(() => {
    if (!session) return null;

    for (const call of incomingCalls) {
      const match = selectCanonicalBrowserMediaLeg(
        call,
        session.id,
        session.endpointId,
        mediaObservations,
      );
      if (
        match?.observation.direction === "INBOUND" &&
        ["CONNECTING", "RINGING"].includes(match.observation.state)
      ) {
        return { call, match };
      }
    }

    return null;
  }, [incomingCalls, mediaObservations, session]);

  const callingReady = Boolean(session && isAgentSessionViewReady(session));
  const canRespondToOffer = Boolean(
    headsUpOffer &&
    state?.connection === "CONNECTED" &&
    callingReady &&
    !activeCall &&
    !runtime.takingMediaLegId &&
    !decliningMediaLegId,
  );

  useEffect(() => {
    setCallCenterCurrentCallGuard(activeCall?.id ?? null);
  }, [activeCall?.id]);

  const recentCalls = useMemo(
    () =>
      state?.calls.filter(({ status }) =>
        ["COMPLETED", "VOICEMAIL", "ABANDONED", "FAILED"].includes(status),
      ) ?? [],
    [state],
  );

  useEffect(() => {
    for (const observation of mediaObservations) {
      if (
        observation.state === "ACTIVE" &&
        outboundMediaLegsRef.current.has(observation.mediaLegId)
      ) {
        activateMedia(observation.mediaLegId);
      }
    }
  }, [activateMedia, mediaObservations]);

  const takeCall = useCallback(
    async (call: CallView) => {
      if (!session) return;
      const match = selectCanonicalBrowserMediaLeg(
        call,
        session.id,
        session.endpointId,
        mediaObservations,
      );
      if (!match) {
        setActionError("This call is still connecting. Try again in a moment.");
        return;
      }

      setActionError(null);
      try {
        await runtime.take(match.observation.mediaLegId);
      } catch {
        setActionError("Call ended");
      }
    },
    [mediaObservations, runtime, session],
  );

  const declineCall = useCallback(
    async (mediaLegId: string) => {
      setDecliningMediaLegId(mediaLegId);
      setActionError(null);
      try {
        await Promise.resolve(media.decline(mediaLegId));
      } catch {
        setActionError("The incoming call could not be declined.");
      } finally {
        setDecliningMediaLegId((current) => (current === mediaLegId ? null : current));
      }
    },
    [media],
  );

  const startOutbound = useCallback(async () => {
    if (
      outboundStartingRef.current ||
      !session ||
      !selectedNumberId ||
      !destination.trim()
    ) {
      return;
    }
    outboundStartingRef.current = true;
    setStartingOutbound(true);
    setActionError(null);
    const target = {
      clientInstanceId,
      destination,
      numberId: selectedNumberId,
      queueId,
    };
    const operationKey = canonicalOutboundIdempotencyKey(
      window.sessionStorage,
      target,
      () => crypto.randomUUID(),
    );
    try {
      const requestOutbound = async () => {
        const response = await fetch("/api/portal/call-center/outbound", {
          body: JSON.stringify({
            clientInstanceId,
            destination,
            numberId: selectedNumberId,
            queueId,
          }),
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": operationKey,
          },
          method: "POST",
        });
        return callCenterResponse<{
          callId?: unknown;
          clientState?: unknown;
          from?: unknown;
          to?: unknown;
        }>(response);
      };
      const body = await requestOutbound();
      if (
        typeof body?.callId !== "string" ||
        typeof body?.clientState !== "string" ||
        typeof body.from !== "string" ||
        typeof body.to !== "string"
      ) {
        throw localCallCenterError("OUTBOUND_CALL_FAILED");
      }
      setCallCenterCurrentCallGuard(body.callId);
      const mediaLegId = dialMediaLeg({
        callerNumber: body.from,
        clientState: body.clientState,
        destinationNumber: body.to,
      });
      outboundMediaLegsRef.current.add(mediaLegId);
      completeCanonicalOutboundOperation(window.sessionStorage, target, operationKey);
      setDestination("");
    } catch (error) {
      setActionError(errorMessage(error, "outbound"));
    } finally {
      outboundStartingRef.current = false;
      setStartingOutbound(false);
    }
  }, [clientInstanceId, destination, dialMediaLeg, queueId, selectedNumberId, session]);

  if (realtime.error && !state) {
    return (
      <CanonicalUnavailable
        message={errorMessage(realtime.error, "connect")}
        retry={refreshSnapshot}
      />
    );
  }
  if (realtime.loading || !state) {
    return <CanonicalUnavailable message="Connecting to the call center…" />;
  }

  const outboundHelp = activeCall
    ? "Finish the current call before starting another."
    : headsUpOffer
      ? "Answer or decline the incoming call before placing another call."
      : !callingReady
        ? "Calling is not ready yet."
        : !selectedNumberId
          ? "No practice number is configured."
          : "Enter a phone number to call.";
  const canStartOutbound = Boolean(
    callingReady &&
    !activeCall &&
    !headsUpOffer &&
    selectedNumberId &&
    destination.trim() &&
    !startingOutbound,
  );
  const queueName = office || "Call center";

  return (
    <div className="space-y-4 pb-64 lg:pb-0">
      <CallCenterLeaveGuard active={Boolean(headsUpOffer || activeCall)} />
      <IncomingOfferAnnouncement
        call={headsUpOffer?.call ?? null}
        queueName={queueName}
      />

      {headsUpOffer ? (
        <div className="pointer-events-none fixed inset-x-3 top-[max(5rem,calc(1rem+env(safe-area-inset-top)))] z-40 mx-auto max-w-sm md:left-auto md:right-6 md:top-24">
          <div className="pointer-events-auto">
            <IncomingCallHeadsUp
              canRespond={canRespondToOffer}
              call={headsUpOffer.call}
              onAnswer={() => void takeCall(headsUpOffer.call)}
              onDecline={() =>
                void declineCall(headsUpOffer.match.observation.mediaLegId)
              }
              pending={
                runtime.takingMediaLegId === headsUpOffer.match.observation.mediaLegId
                  ? "answer"
                  : decliningMediaLegId === headsUpOffer.match.observation.mediaLegId
                    ? "decline"
                    : null
              }
              queueName={queueName}
            />
          </div>
        </div>
      ) : null}

      {realtime.error ? (
        <section
          className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <div>
            <p className="font-medium">Call activity delayed — retrying</p>
          </div>
          <Button onClick={refreshSnapshot} size="sm" variant="secondary">
            Retry
          </Button>
        </section>
      ) : null}

      {runtime.error ? (
        <section
          className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <p>{session ? "Phone disconnected — reconnecting" : runtime.error}</p>
          {!session ? (
            <Button
              onClick={() =>
                void runtime.takeover().catch(() => {
                  setActionError("The phone could not move to this tab");
                })
              }
              size="sm"
              variant="secondary"
            >
              Use phone here
            </Button>
          ) : null}
        </section>
      ) : null}

      {actionError ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {actionError}
        </p>
      ) : null}

      {runtime.ringtone.blocked ? (
        <section
          className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"
          role="status"
        >
          <p>Incoming call waiting. Turn on sound to hear the ringtone.</p>
          <Button onClick={runtime.ringtone.retry} size="sm" variant="secondary">
            Turn on sound
          </Button>
        </section>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section
            aria-labelledby="live-queue-heading"
            className="overflow-hidden rounded-2xl border border-[var(--portal-border)] bg-white shadow-sm"
          >
            <header className="flex items-center justify-between gap-3 border-b border-[var(--portal-border)] bg-[var(--portal-panel-soft)] px-4 py-4 sm:px-5">
              <div>
                <h2
                  className="text-base font-semibold text-[var(--portal-ink)]"
                  id="live-queue-heading"
                >
                  Live queue
                </h2>
                <p className="mt-1 text-sm text-[var(--portal-muted)]">
                  {realtime.error
                    ? "Showing the last known queue."
                    : "Incoming calls waiting for an operator."}
                </p>
              </div>
              <PortalBadge
                className="tabular-nums"
                tone={!realtime.error && state.counts.waiting ? "accent" : "soft"}
              >
                {realtime.error ? "Updates paused" : `${state.counts.waiting} waiting`}
              </PortalBadge>
            </header>

            {incomingCalls.length ? (
              <ul className="divide-y divide-[var(--portal-border)]">
                {incomingCalls.map((call) => {
                  const match = session
                    ? selectCanonicalBrowserMediaLeg(
                        call,
                        session.id,
                        session.endpointId,
                        mediaObservations,
                      )
                    : null;
                  const taking =
                    match?.observation.mediaLegId === runtime.takingMediaLegId;
                  const declining = match?.observation.mediaLegId === decliningMediaLegId;
                  const phone = formatPhone(callCounterpartyPhone(call));
                  const caller = call.callerName || phone;
                  const offered = Boolean(match);
                  const status = declining
                    ? "Declining…"
                    : taking
                      ? "Connecting…"
                      : offered
                        ? "Ringing for you"
                        : "Waiting in queue";

                  return (
                    <li
                      className="flex flex-col gap-3 px-4 py-4 transition hover:bg-[var(--portal-panel-soft)] sm:flex-row sm:items-center sm:justify-between sm:px-5"
                      key={call.id}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
                            offered
                              ? "bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]"
                              : "bg-[var(--portal-panel-soft)] text-[var(--portal-muted)]"
                          }`}
                        >
                          <PhoneIncoming className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--portal-ink)]">
                            {caller}
                          </p>
                          {call.callerName ? (
                            <p className="mt-0.5 truncate text-xs text-[var(--portal-muted)]">
                              {phone}
                            </p>
                          ) : null}
                          <p
                            className={`mt-1 text-xs font-medium ${
                              offered
                                ? "text-[var(--portal-accent)]"
                                : "text-[var(--portal-muted)]"
                            }`}
                          >
                            {status}
                          </p>
                        </div>
                      </div>
                      {match ? (
                        <Button
                          aria-label={`Answer ${caller}`}
                          className="w-fit"
                          disabled={!canRespondToOffer || taking || declining}
                          onClick={() => void takeCall(call)}
                          size="sm"
                          variant="primary"
                        >
                          {declining ? "Declining…" : taking ? "Connecting…" : "Answer"}
                        </Button>
                      ) : (
                        <PortalBadge className="w-fit" tone="soft">
                          Waiting
                        </PortalBadge>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-5 py-10 text-center">
                <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-[var(--portal-panel-soft)] text-[var(--portal-muted)]">
                  <PhoneIncoming className="h-4 w-4" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-medium text-[var(--portal-ink)]">
                  {realtime.error ? "Queue status unavailable." : "Queue is clear."}
                </p>
                <p className="mt-1 text-xs text-[var(--portal-muted)]">
                  {realtime.error
                    ? "Retry updates to see who is waiting."
                    : "New incoming calls will appear here."}
                </p>
              </div>
            )}
          </section>

          <CanonicalActivity
            followUpHref={followUpHref}
            historyHref={historyHref}
            needsAction={needsAction}
            needsActionCount={needsActionCount}
            office={office}
            onCallback={setDestination}
            queueId={queueId}
            recentCalls={recentCalls}
            recentCount={state.counts.recent}
          />
        </div>

        <div
          className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 max-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] scroll-mt-4 overflow-y-auto md:inset-x-auto md:right-5 md:w-[22rem] lg:sticky lg:right-auto lg:top-24 lg:z-10 lg:max-h-[calc(100dvh-7rem)] lg:w-auto"
          id="softphone"
        >
          <section className="overflow-hidden rounded-2xl border border-[var(--portal-border)] bg-white shadow-[0_18px_50px_rgba(16,39,44,0.14)] lg:shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--portal-border)] bg-[var(--portal-panel-soft)] px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--portal-muted)]">
                  Calling
                </p>
                <p className="mt-0.5 truncate text-sm font-medium text-[var(--portal-ink)]">
                  {selectedOutboundNumber
                    ? `${selectedOutboundNumber.label} · ${formatPhone(selectedOutboundNumber.phoneNumber)}`
                    : "No practice number"}
                </p>
              </div>
              <CallConnectionStatus session={session} />
            </div>

            <div className="space-y-4 p-4">
              {eligibleOutboundNumbers.length > 1 ? (
                <label className="flex flex-col gap-1.5 text-sm font-medium text-[var(--portal-ink)]">
                  Practice number
                  <PortalSelect
                    disabled={Boolean(activeCall || headsUpOffer)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setNumberChoice(value);
                      try {
                        window.localStorage.setItem(OUTBOUND_NUMBER_STORAGE_KEY, value);
                      } catch {
                        // Storage is optional.
                      }
                    }}
                    value={selectedNumberId}
                  >
                    {eligibleOutboundNumbers.map((number) => (
                      <option key={number.id} value={number.id}>
                        {number.label} - {formatPhone(number.phoneNumber)}
                      </option>
                    ))}
                  </PortalSelect>
                </label>
              ) : null}

              {activeCall ? (
                <CanonicalActiveCall
                  call={activeCall}
                  endpointId={agentProfileId}
                  key={activeCall.id}
                  media={media}
                  sessionId={session?.id ?? null}
                />
              ) : (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      aria-label="Phone number"
                      className="h-10 min-w-0 flex-1 text-sm font-medium"
                      inputMode="tel"
                      onChange={(event) => setDestination(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && canStartOutbound) {
                          void startOutbound();
                        }
                      }}
                      placeholder="Phone number"
                      type="tel"
                      value={destination}
                    />
                    <Button
                      aria-label="Clear number"
                      disabled={!destination}
                      onClick={() => setDestination("")}
                      variant="secondary"
                    >
                      <Delete className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button
                      disabled={!canStartOutbound}
                      onClick={() => void startOutbound()}
                      variant="primary"
                    >
                      <Phone className="h-4 w-4" aria-hidden="true" />
                      {startingOutbound ? "Calling" : "Call"}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs leading-relaxed text-[var(--portal-muted)]">
                      {outboundHelp}
                    </p>
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button className="shrink-0" size="sm" variant="ghost">
                          <Grid3X3 className="h-4 w-4" aria-hidden="true" />
                          More
                        </Button>
                      </SheetTrigger>
                      <SheetContent
                        className="portal-platform overflow-y-auto"
                        side="right"
                      >
                        <SheetHeader className="pr-12">
                          <SheetTitle>Dialing controls</SheetTitle>
                          <SheetDescription>
                            Enter the number you want to call.
                          </SheetDescription>
                        </SheetHeader>
                        <div className="grid grid-cols-3 gap-2 px-5">
                          {keypadDigits.map((digit) => (
                            <Button
                              key={digit}
                              onClick={() => setDestination((current) => current + digit)}
                              variant="secondary"
                            >
                              {digit}
                            </Button>
                          ))}
                        </div>
                      </SheetContent>
                    </Sheet>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function CanonicalActiveCall({
  call,
  endpointId,
  media,
  sessionId,
}: {
  call: CallView;
  endpointId: string;
  media: Omit<ReturnType<typeof useSoftphoneMedia>, "setRemoteAudioElement">;
  sessionId: string | null;
}) {
  const [callDuration, setCallDuration] = useState(0);
  const [controlError, setControlError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [isMuted, setMuted] = useState(false);
  const match = sessionId
    ? selectCanonicalBrowserMediaLeg(call, sessionId, endpointId, media.observations)
    : null;
  const canEnd = Boolean(match);
  const phone = formatPhone(callPhone(call));
  const connected = call.status === "CONNECTED";
  const mediaLegId = match?.observation.mediaLegId ?? null;
  const isHeld = match?.observation.state === "HELD";
  const controlsEnabled = Boolean(
    mediaLegId &&
    (match?.leg.status === "BRIDGED" ||
      ["ACTIVE", "HELD"].includes(match?.observation.state ?? "")),
  );

  useEffect(() => {
    if (!connected) return;

    const answeredAt = call.answeredAt ? new Date(call.answeredAt).getTime() : NaN;
    const connectedAt = Number.isFinite(answeredAt) ? answeredAt : Date.now();
    const updateDuration = () => {
      setCallDuration(Math.max(0, Math.floor((Date.now() - connectedAt) / 1000)));
    };

    updateDuration();
    const timer = window.setInterval(() => {
      updateDuration();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [call.answeredAt, connected]);

  const showControlError = (error: unknown, action: CallCenterAction) => {
    setControlError(errorMessage(error, action));
  };

  const toggleMute = () => {
    if (!mediaLegId) return;

    try {
      media.mute(mediaLegId, !isMuted);
      setMuted((current) => !current);
      setControlError(null);
    } catch (error) {
      showControlError(error, "mute");
    }
  };

  const toggleHold = async () => {
    if (!mediaLegId) return;

    try {
      await Promise.resolve(media.hold(mediaLegId, !isHeld));
      setControlError(null);
    } catch (error) {
      showControlError(error, "hold");
    }
  };

  const sendDigit = (digit: string) => {
    if (!mediaLegId) return;

    try {
      media.sendDtmf(mediaLegId, digit);
      setControlError(null);
    } catch (error) {
      showControlError(error, "keypad");
    }
  };

  const endCall = async () => {
    if (!mediaLegId || ending) return;

    setEnding(true);
    try {
      media.hangup(mediaLegId);
      setControlError(null);
    } catch (error) {
      showControlError(error, "end");
      setEnding(false);
    }
  };

  if (connected) {
    return (
      <div className="rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] p-4">
        {controlError ? (
          <p className="mb-3 text-sm text-[var(--portal-danger)]" role="alert">
            {controlError}
          </p>
        ) : null}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--portal-ink)]">
              {call.callerName || phone}
            </p>
            <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--portal-muted)]">
              {call.direction === "OUTBOUND" ? "Outbound call" : "Inbound call"}
              {call.callerName ? ` · ${phone}` : ""}
            </p>
          </div>
          <p className="font-mono text-lg font-semibold tabular-nums text-[var(--portal-ink)]">
            {formatCallDuration(callDuration)}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            aria-pressed={isHeld}
            disabled={!controlsEnabled || ending}
            onClick={() => void toggleHold()}
            variant={isHeld ? "default" : "secondary"}
          >
            {isHeld ? (
              <Play className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Pause className="h-4 w-4" aria-hidden="true" />
            )}
            {isHeld ? "Resume" : "Hold"}
          </Button>
          <Button
            aria-pressed={isMuted}
            disabled={!controlsEnabled || ending}
            onClick={toggleMute}
            variant={isMuted ? "default" : "secondary"}
          >
            {isMuted ? (
              <MicOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Mic className="h-4 w-4" aria-hidden="true" />
            )}
            {isMuted ? "Unmute" : "Mute"}
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <Button disabled={!controlsEnabled || ending} variant="secondary">
                <Grid3X3 className="h-4 w-4" aria-hidden="true" />
                Keypad
              </Button>
            </SheetTrigger>
            <SheetContent className="portal-platform overflow-y-auto" side="right">
              <SheetHeader className="pr-12">
                <SheetTitle>Call keypad</SheetTitle>
                <SheetDescription>Send a keypad tone during this call.</SheetDescription>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-2 px-5">
                {keypadDigits.map((digit) => (
                  <Button
                    key={digit}
                    onClick={() => sendDigit(digit)}
                    variant="secondary"
                  >
                    {digit}
                  </Button>
                ))}
              </div>
            </SheetContent>
          </Sheet>
          <Button
            disabled={!controlsEnabled || ending}
            onClick={() => void endCall()}
            variant="destructive"
          >
            <PhoneOff className="h-4 w-4" aria-hidden="true" />
            {ending ? "Ending" : "End"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--portal-ink)]">
            {call.callerName || phone}
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--portal-muted)]">
            {call.direction === "OUTBOUND" ? "Outbound call" : "Inbound call"}
            {call.callerName ? ` · ${phone}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!canEnd}
            onClick={() => void endCall()}
            size="sm"
            variant="secondary"
          >
            <PhoneOff className="h-4 w-4" aria-hidden="true" />
            End
          </Button>
        </div>
      </div>
    </div>
  );
}

function CanonicalActivity({
  followUpHref,
  historyHref,
  needsAction,
  needsActionCount,
  office,
  onCallback,
  queueId,
  recentCalls,
  recentCount,
}: {
  followUpHref: string;
  historyHref: string;
  needsAction: PortalNeedsActionGroup[];
  needsActionCount: number;
  office?: string | null;
  onCallback: (phone: string) => void;
  queueId: string;
  recentCalls: CallView[];
  recentCount: number;
}) {
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const visibleRecentCalls = recentCalls.slice(0, RECENT_CALL_PREVIEW_LIMIT);

  return (
    <>
      <ActivityRail
        followUpHref={followUpHref}
        needsAction={needsAction}
        needsActionCount={needsActionCount}
        office={office}
        onCallback={onCallback}
        queueId={queueId}
      />

      <section className="overflow-hidden rounded-xl border border-[var(--portal-border)] bg-white shadow-sm">
        <header className="flex items-center gap-3 border-b border-[var(--portal-border)] px-4 py-3">
          <button
            aria-expanded={connectionsOpen}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => setConnectionsOpen((current) => !current)}
            type="button"
          >
            {connectionsOpen ? (
              <ChevronDown
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-[var(--portal-muted)]"
              />
            ) : (
              <ChevronRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-[var(--portal-muted)]"
              />
            )}
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--portal-ink)]">
                  Recent calls
                </span>
                <PortalBadge className="px-2 py-0.5 tabular-nums">
                  {recentCount}
                </PortalBadge>
              </span>
              <span className="mt-0.5 block text-xs text-[var(--portal-muted)]">
                Inbound and outbound call outcomes.
              </span>
            </span>
          </button>
          <Link
            className="shrink-0 text-xs font-semibold text-[var(--portal-accent)] hover:underline"
            href={historyHref}
          >
            View all
          </Link>
        </header>

        {!connectionsOpen ? null : visibleRecentCalls.length ? (
          <ul className="divide-y divide-[var(--portal-border)]">
            {visibleRecentCalls.map((call) => {
              const DirectionIcon =
                call.direction === "OUTBOUND" ? PhoneOutgoing : PhoneIncoming;
              const contactPhone = callCounterpartyPhone(call);
              const phone = formatPhone(contactPhone);
              const callerHref = contactPhone
                ? `/portal/app/call-center/callers/${encodeURIComponent(contactPhone)}`
                : null;

              return (
                <li
                  className="flex items-center justify-between gap-4 px-5 py-3.5"
                  key={call.id}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--portal-panel-soft)] text-[var(--portal-muted)]">
                      <DirectionIcon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      {callerHref ? (
                        <Link
                          className="block truncate text-sm font-medium text-[var(--portal-accent)] underline-offset-2 hover:underline"
                          href={callerHref}
                        >
                          {call.callerName || phone}
                        </Link>
                      ) : (
                        <p className="truncate text-sm font-medium text-[var(--portal-ink)]">
                          {call.callerName || phone}
                        </p>
                      )}
                      <p className="mt-0.5 truncate text-xs text-[var(--portal-muted)]">
                        {call.callerName ? `${phone} · ` : ""}
                        {call.direction === "OUTBOUND" ? "Outbound" : "Inbound"}
                        {` · ${formatRelativeTime(call.endedAt || call.receivedAt)}`}
                      </p>
                    </div>
                  </div>
                  <PortalBadge className={callStatusClassName(call.status)}>
                    {callStatusLabel(call.status)}
                  </PortalBadge>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-[var(--portal-muted)]">
            No recent calls yet.
          </div>
        )}
      </section>
    </>
  );
}

function callStatusLabel(status: CallView["status"]) {
  switch (status) {
    case "ABANDONED":
      return "Missed";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    case "VOICEMAIL":
      return "Voicemail";
    default:
      return status.toLowerCase().replaceAll("_", " ");
  }
}

function callStatusClassName(status: CallView["status"]) {
  switch (status) {
    case "COMPLETED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "VOICEMAIL":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "ABANDONED":
    case "FAILED":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-[var(--portal-border)] bg-[var(--portal-panel-soft)] text-[var(--portal-muted)]";
  }
}

function formatRelativeTime(value: string, now = Date.now()) {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "Recently";
  }

  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function callPhone(call: CallView) {
  return call.direction === "OUTBOUND" ? call.toPhone : call.fromPhone;
}

function CanonicalUnavailable({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <Card className="items-center gap-3 rounded-2xl bg-white px-6 py-10 text-center shadow-sm ring-[var(--portal-border)]">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--portal-panel-soft)] text-[var(--portal-accent)]">
        <Headphones className="h-5 w-5" aria-hidden="true" />
      </div>
      <p className="max-w-md text-sm leading-relaxed text-[var(--portal-muted)]">
        {message}
      </p>
      {retry ? (
        <Button onClick={retry} size="sm" variant="secondary">
          Try again
        </Button>
      ) : null}
    </Card>
  );
}
