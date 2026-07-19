"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Delete,
  Headphones,
  Mic,
  MicOff,
  Phone,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
} from "lucide-react";

import { PortalBadge } from "@/app/portal/app/PortalBadge";
import { PortalSelect } from "@/app/portal/app/PortalFields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

  const callingReady = Boolean(session && isAgentSessionViewReady(session));

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
    : !callingReady
      ? "Connect to calling before placing an outbound call."
      : session?.presence !== "AVAILABLE"
        ? "Wait until you are Ready to place a call."
        : !selectedNumberId
          ? "No outbound caller number is configured."
          : "Enter a patient number to begin.";
  const canStartOutbound = Boolean(
    session?.presence === "AVAILABLE" &&
    session.connectionState === "READY" &&
    !activeCall &&
    selectedNumberId &&
    destination.trim() &&
    !startingOutbound,
  );

  return (
    <div className="space-y-4">
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
          <section className="rounded-xl border border-[var(--portal-border)] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--portal-ink)]">
                  Live queue
                </h2>
                <p className="mt-1 text-sm text-[var(--portal-muted)]">
                  Live callers that need an answer.
                </p>
              </div>
              <PortalBadge className="tabular-nums">{incomingCalls.length}</PortalBadge>
            </div>

            {incomingCalls.length ? (
              <ul className="space-y-3">
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
                  const phone = formatPhone(callPhone(call));

                  return (
                    <li
                      className="flex flex-col gap-3 border-b border-[var(--portal-border)] py-3 first:mt-2 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                      key={call.id}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--portal-ink)]">
                          {call.callerName || phone}
                        </p>
                        <p className="mt-1 text-xs text-[var(--portal-muted)]">
                          {call.callerName ? `${phone} · ` : ""}
                          {taking ? "Connecting…" : match ? "Ringing" : "Preparing"}
                        </p>
                      </div>
                      <Button
                        className="w-fit"
                        disabled={
                          !session ||
                          !match ||
                          Boolean(runtime.takingMediaLegId) ||
                          Boolean(activeCall)
                        }
                        onClick={() => void takeCall(call)}
                        size="sm"
                        variant="primary"
                      >
                        {taking ? "Answering" : "Answer"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-[var(--portal-border-strong)] px-3 py-4 text-center text-sm text-[var(--portal-muted)]">
                No callers waiting.
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
          />
        </div>

        <div className="scroll-mt-4 space-y-3" id="softphone">
          <section className="rounded-xl border border-[var(--portal-border)] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--portal-ink)]">Calling</h2>
              <CallConnectionStatus session={session} />
            </div>
          </section>

          {eligibleOutboundNumbers.length > 1 ? (
            <section className="rounded-xl border border-[var(--portal-border)] bg-white p-4 shadow-sm">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-[var(--portal-ink)]">
                Outbound number
                <PortalSelect
                  disabled={!eligibleOutboundNumbers.length}
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
            </section>
          ) : null}

          <section className="rounded-lg border border-[var(--portal-border)] bg-white shadow-[0_14px_40px_rgba(16,39,44,0.04)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--portal-border)] px-4 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--portal-muted)]">
                  Softphone
                </p>
                <p className="mt-1 text-sm font-medium text-[var(--portal-ink)]">
                  {selectedOutboundNumber
                    ? formatPhone(selectedOutboundNumber.phoneNumber)
                    : "No caller number"}
                </p>
              </div>
            </div>

            <div className="space-y-4 p-4">
              {activeCall ? (
                <CanonicalActiveCall
                  call={activeCall}
                  endpointId={agentProfileId}
                  key={activeCall.id}
                  media={media}
                  sessionId={session?.id ?? null}
                />
              ) : (
                <>
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
                  <div className="grid max-w-60 grid-cols-3 gap-2">
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
                  <p className="text-xs leading-relaxed text-[var(--portal-muted)]">
                    {outboundHelp}
                  </p>
                </>
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
  const controlsEnabled = Boolean(
    mediaLegId &&
    (match?.leg.status === "BRIDGED" || match?.observation.state === "ACTIVE"),
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
              {call.direction === "OUTBOUND" ? "Outbound" : "Patient call"}
              {call.callerName ? ` · ${phone}` : ""}
            </p>
          </div>
          <p className="font-mono text-lg font-semibold tabular-nums text-[var(--portal-ink)]">
            {formatCallDuration(callDuration)}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
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
          <Button
            disabled={!controlsEnabled || ending}
            onClick={() => void endCall()}
            variant="secondary"
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
            {call.direction === "OUTBOUND" ? "Outbound" : "Patient call"}
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
}: {
  followUpHref: string;
  historyHref: string;
  needsAction: PortalNeedsActionGroup[];
  needsActionCount: number;
  office?: string | null;
  onCallback: (phone: string) => void;
  queueId: string;
  recentCalls: CallView[];
}) {
  const [connectionsOpen, setConnectionsOpen] = useState(false);

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
                {recentCalls.length ? (
                  <PortalBadge className="px-2 py-0.5 tabular-nums">
                    {recentCalls.length}
                  </PortalBadge>
                ) : null}
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

        {!connectionsOpen ? null : recentCalls.length ? (
          <ul className="max-h-72 divide-y divide-[var(--portal-border)] overflow-y-auto">
            {recentCalls.map((call) => {
              const DirectionIcon =
                call.direction === "OUTBOUND" ? PhoneOutgoing : PhoneIncoming;
              const patientPhone = callPhone(call);
              const phone = formatPhone(patientPhone);
              const callerHref = patientPhone
                ? `/portal/app/call-center/callers/${encodeURIComponent(patientPhone)}`
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
