"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Delete,
  Grid3X3,
  Headphones,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneForwarded,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Play,
  Voicemail,
} from "lucide-react";

import { PortalBadge } from "@/app/portal/app/PortalBadge";
import { PortalSelect } from "@/app/portal/app/PortalFields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CanonicalOutboundNumber } from "@/lib/call-center/application/portal-canonical-workspace";
import {
  selectIncomingCalls,
  type AgentSessionView,
  type CallView,
  type OperationView,
  type TaskView,
  type TransferTargetView,
} from "@/lib/call-center/realtime-contract";
import { formatPhone } from "@/lib/format";

import {
  claimCallCenterClientInstance,
  type CallCenterClientInstance,
} from "./call-center-client-instance";
import { setCallCenterCurrentCallGuard } from "./call-center-current-call-guard";
import {
  beginCanonicalTransfer,
  beginCanonicalTake,
  canonicalOutboundIdempotencyKey,
  canonicalClaimIdempotencyKey,
  canonicalTransferIdempotencyKey,
  completeCanonicalOutboundOperation,
  operationShouldAnswerMedia,
  selectCanonicalAgentActiveCall,
  selectCanonicalBrowserMediaLeg,
  selectCanonicalTransferSource,
  selectCanonicalTransferTakeCandidate,
  selectLatestClaimOperation,
  selectLatestTransferOperation,
} from "./canonical-active-call-center";
import {
  type CanonicalAgentConnectionState,
  useCanonicalAgentSession,
} from "./use-canonical-agent-session";
import { useCanonicalCallCenter } from "./use-canonical-call-center";
import { useSoftphoneMedia } from "./use-softphone";

type CanonicalActiveWorkspaceProps = {
  actionsEnabled: boolean;
  enabled: boolean;
  historyHref: string;
  outboundNumbers: CanonicalOutboundNumber[];
  queueId: string | null;
};

const keypadDigits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function formatCallDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainingSeconds = (seconds % 60).toString().padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

function canonicalConnectionState(
  state: ReturnType<typeof useSoftphoneMedia>["connection"],
): CanonicalAgentConnectionState {
  if (state === "READY") return "READY";
  if (state === "CONNECTING") return "CONNECTING";
  if (state === "FAILED") return "ERROR";
  return "CLOSED";
}

export function CanonicalActiveWorkspace({
  actionsEnabled,
  enabled,
  historyHref,
  outboundNumbers,
  queueId,
}: CanonicalActiveWorkspaceProps) {
  const [client, setClient] = useState<CallCenterClientInstance | null>(null);
  const [identityError, setIdentityError] = useState(false);

  useEffect(() => {
    let active = true;
    let claimed: CallCenterClientInstance | null = null;
    void claimCallCenterClientInstance()
      .then((next) => {
        if (!active) {
          next.release();
          return;
        }
        claimed = next;
        setClient(next);
      })
      .catch(() => {
        if (active) setIdentityError(true);
      });
    return () => {
      active = false;
      claimed?.release();
    };
  }, []);

  if (!enabled) {
    return <CanonicalUnavailable message="Calling is turned off for this practice." />;
  }
  if (!queueId) {
    return (
      <CanonicalUnavailable message="Calling is not configured for this location." />
    );
  }
  if (identityError) {
    return (
      <CanonicalUnavailable message="This browser could not start calling. Refresh and try again." />
    );
  }
  if (!client) return <CanonicalUnavailable message="Connecting to the call center…" />;

  return (
    <ConnectedCanonicalActiveWorkspace
      clientInstanceId={client.clientInstanceId}
      actionsEnabled={actionsEnabled}
      historyHref={historyHref}
      outboundNumbers={outboundNumbers}
      queueId={queueId}
    />
  );
}

function ConnectedCanonicalActiveWorkspace({
  actionsEnabled,
  clientInstanceId,
  historyHref,
  outboundNumbers,
  queueId,
}: {
  actionsEnabled: boolean;
  clientInstanceId: string;
  historyHref: string;
  outboundNumbers: CanonicalOutboundNumber[];
  queueId: string;
}) {
  const realtime = useCanonicalCallCenter({ clientInstanceId, queueId });
  const refreshSnapshot = realtime.refetch;
  const [presence, setPresence] = useState<AgentSessionView["presence"]>("AVAILABLE");
  const [actionError, setActionError] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [numberChoice, setNumberChoice] = useState("");
  const [startingOutbound, setStartingOutbound] = useState(false);
  const [submittingDisposition, setSubmittingDisposition] = useState<string | null>(null);
  const [mediaReadiness, setMediaReadiness] = useState({
    audioReady: false,
    connectionState: "CLOSED" as CanonicalAgentConnectionState,
    microphoneReady: false,
  });
  const takingRef = useRef(new Set<string>());
  const transferringRef = useRef(new Set<string>());
  const answeredMediaRef = useRef(new Set<string>());
  const outboundMediaLegsRef = useRef(new Set<string>());
  const outboundStartingRef = useRef(false);
  const agentProfileId = realtime.state?.agentProfile?.id ?? "";
  const eligibleOutboundNumbers = outboundNumbers;
  const selectedNumberId = eligibleOutboundNumbers.some(({ id }) => id === numberChoice)
    ? numberChoice
    : (eligibleOutboundNumbers[0]?.id ?? "");
  const selectedOutboundNumber = eligibleOutboundNumbers.find(
    ({ id }) => id === selectedNumberId,
  );
  const state = realtime.state;
  const projectedSession =
    state?.agentSession?.clientInstanceId === clientInstanceId &&
    state.agentSession.endpointId === agentProfileId
      ? state.agentSession
      : null;
  const canonicalSession = useCanonicalAgentSession({
    audioReady: mediaReadiness.audioReady,
    clientInstanceId,
    connectionState: mediaReadiness.connectionState,
    microphoneReady: mediaReadiness.microphoneReady,
    presence:
      mediaReadiness.connectionState === "READY" &&
      mediaReadiness.audioReady &&
      mediaReadiness.microphoneReady
        ? presence
        : "PAUSED",
    projectedSession,
  });
  const leasedSession = canonicalSession.session;
  const leasedSessionId = leasedSession?.id ?? null;
  const leasedCurrentCallId = leasedSession?.currentCallId ?? null;
  const leasedOfferedCallId = leasedSession?.offeredCallId ?? null;
  const media = useSoftphoneMedia({
    agentSessionId: leasedSessionId,
    autoPrepare: Boolean(agentProfileId),
    browserSessionId: clientInstanceId,
    credentialMode: "CANONICAL",
    enabled: Boolean(agentProfileId && leasedSession?.endpointId === agentProfileId),
    stationSeatId: agentProfileId || null,
  });
  const {
    activate: activateMedia,
    answer: answerMediaLeg,
    dial: dialMediaLeg,
    observations: mediaObservations,
  } = media;
  const {
    error: canonicalSessionError,
    start: startCanonicalSession,
    stop: stopCanonicalSession,
  } = canonicalSession;

  useEffect(() => {
    const next = {
      audioReady: media.soundReady,
      connectionState: canonicalConnectionState(media.connection),
      microphoneReady: media.microphoneReady,
    };
    setMediaReadiness((current) =>
      current.audioReady === next.audioReady &&
      current.connectionState === next.connectionState &&
      current.microphoneReady === next.microphoneReady
        ? current
        : next,
    );
  }, [media.connection, media.microphoneReady, media.soundReady]);

  useEffect(() => {
    if (agentProfileId && presence !== "OFFLINE") {
      void startCanonicalSession();
    } else {
      void stopCanonicalSession();
    }
    return () => {
      void stopCanonicalSession();
    };
  }, [presence, agentProfileId, startCanonicalSession, stopCanonicalSession]);

  const session = leasedSession;

  useEffect(() => {
    if (!state || !leasedSessionId) return;
    setCallCenterCurrentCallGuard(
      session?.currentCallId ??
        session?.offeredCallId ??
        leasedCurrentCallId ??
        leasedOfferedCallId,
    );
  }, [
    leasedCurrentCallId,
    leasedOfferedCallId,
    leasedSessionId,
    session?.currentCallId,
    session?.offeredCallId,
    state,
  ]);
  const incomingCalls = useMemo(() => (state ? selectIncomingCalls(state) : []), [state]);
  const transferTakeCandidate =
    state && session
      ? selectCanonicalTransferTakeCandidate(
          state.calls,
          state.operations,
          session,
          mediaObservations,
        )
      : null;
  const activeCall =
    transferTakeCandidate?.call ??
    selectCanonicalAgentActiveCall(state?.calls ?? [], session);

  useEffect(() => {
    if (activeCall?.status === "CONNECTED") refreshSnapshot();
  }, [activeCall?.id, activeCall?.status, refreshSnapshot]);

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

  const answerMedia = useCallback(
    async (mediaLegId: string) => {
      if (answeredMediaRef.current.has(mediaLegId)) return;
      answeredMediaRef.current.add(mediaLegId);
      try {
        await Promise.resolve(answerMediaLeg(mediaLegId));
        activateMedia(mediaLegId);
      } catch (error) {
        answeredMediaRef.current.delete(mediaLegId);
        throw error;
      }
    },
    [activateMedia, answerMediaLeg],
  );

  useEffect(() => {
    if (!state || !session) return;
    for (const call of incomingCalls) {
      const match = selectCanonicalBrowserMediaLeg(
        call,
        session.id,
        session.endpointId,
        mediaObservations,
      );
      if (!match || !["RINGING", "CONNECTING"].includes(match.observation.state)) {
        continue;
      }
      const operation = selectLatestClaimOperation(state.operations, {
        agentSessionId: session.id,
        callId: call.id,
        endpointId: session.endpointId,
        legId: match.leg.id,
      });
      if (!operationShouldAnswerMedia(operation)) continue;
      void answerMedia(match.observation.mediaLegId).catch(() => {
        setActionError("The matching browser media leg could not be answered.");
      });
    }
  }, [answerMedia, incomingCalls, mediaObservations, session, state]);

  const takeCall = useCallback(
    async (call: CallView) => {
      if (!actionsEnabled || !session) return;
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
      if (!beginCanonicalTake(takingRef.current, call.id)) return;

      setActionError(null);
      setCallCenterCurrentCallGuard(call.id);
      try {
        const response = await fetch(
          `/api/portal/call-center/calls/${encodeURIComponent(call.id)}/claim`,
          {
            body: JSON.stringify({
              clientInstanceId,
              expectedSessionStateVersion: session.stateVersion,
            }),
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": canonicalClaimIdempotencyKey(call.id, session.id),
            },
            method: "POST",
          },
        );
        if (!response.ok) {
          throw new Error("We could not answer this call. Try again.");
        }
        await answerMedia(match.observation.mediaLegId);
      } catch (error) {
        setCallCenterCurrentCallGuard(session.currentCallId);
        setActionError(
          error instanceof Error
            ? error.message
            : "We could not answer this call. Try again.",
        );
      } finally {
        takingRef.current.delete(call.id);
      }
    },
    [actionsEnabled, answerMedia, clientInstanceId, mediaObservations, session],
  );

  const takeTransfer = useCallback(async () => {
    if (!actionsEnabled || !transferTakeCandidate) return;
    setActionError(null);
    try {
      await answerMedia(transferTakeCandidate.observation.mediaLegId);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "We could not answer this transfer. Try again.",
      );
    }
  }, [actionsEnabled, answerMedia, transferTakeCandidate]);

  const transferActiveCall = useCallback(
    async (call: CallView, targetUserId: string) => {
      if (!actionsEnabled || !session) return;
      const source = selectCanonicalTransferSource(call, session);
      if (!source) {
        setActionError("The connected source leg is unavailable for transfer.");
        return;
      }
      if (!beginCanonicalTransfer(transferringRef.current, call.id, source.id)) return;

      setActionError(null);
      try {
        const response = await fetch(
          `/api/portal/call-center/calls/${encodeURIComponent(call.id)}/transfer`,
          {
            body: JSON.stringify({ targetUserId }),
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": canonicalTransferIdempotencyKey(
                call.id,
                source.id,
                targetUserId,
              ),
            },
            method: "POST",
          },
        );
        const body = (await response.json().catch(() => null)) as {
          detail?: unknown;
          error?: unknown;
        } | null;
        if (!response.ok) {
          throw new Error(
            typeof body?.detail === "string"
              ? body.detail
              : typeof body?.error === "string"
                ? body.error
                : "We could not transfer this call. Try again.",
          );
        }
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : "We could not transfer this call. Try again.",
        );
      } finally {
        transferringRef.current.delete(`${call.id}:${source.id}`);
      }
    },
    [actionsEnabled, session],
  );

  const saveDisposition = useCallback(
    async (call: CallView, disposition: string) => {
      if (!actionsEnabled || !state || submittingDisposition) return;
      setSubmittingDisposition(call.id);
      try {
        const response = await fetch(
          `/api/portal/call-center/calls/${encodeURIComponent(call.id)}/disposition`,
          {
            body: JSON.stringify({
              disposition,
              expectedStateVersion: call.stateVersion,
              note: null,
              taskIds: state.tasks
                .filter((task) => task.callId === call.id)
                .map(({ id }) => id),
            }),
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": `canonical-disposition:${call.id}`,
            },
            method: "POST",
          },
        );
        if (!response.ok) throw new Error("We could not mark this follow-up done.");
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : "We could not mark this follow-up done.",
        );
      } finally {
        setSubmittingDisposition(null);
      }
    },
    [actionsEnabled, state, submittingDisposition],
  );

  const startOutbound = useCallback(async () => {
    if (
      outboundStartingRef.current ||
      !actionsEnabled ||
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
      const body = (await response.json().catch(() => null)) as {
        callId?: unknown;
        clientState?: unknown;
        error?: unknown;
        from?: unknown;
        to?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "We could not start this call. Check the number and try again.",
        );
      }
      if (
        typeof body?.callId !== "string" ||
        typeof body?.clientState !== "string" ||
        typeof body.from !== "string" ||
        typeof body.to !== "string"
      ) {
        throw new Error("We could not start this call. Check the number and try again.");
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
      setActionError(
        error instanceof Error
          ? error.message
          : "We could not start this call. Check the number and try again.",
      );
    } finally {
      outboundStartingRef.current = false;
      setStartingOutbound(false);
    }
  }, [
    actionsEnabled,
    clientInstanceId,
    destination,
    dialMediaLeg,
    queueId,
    selectedNumberId,
    session,
  ]);

  if (realtime.error) {
    return (
      <CanonicalUnavailable message="We could not connect to the call center. Refresh to try again." />
    );
  }
  if (realtime.loading || !state) {
    return <CanonicalUnavailable message="Connecting to the call center…" />;
  }

  const stationPresence = session?.presence ?? presence;
  const callingReady = Boolean(
    session?.connectionState === "READY" && session.microphoneReady && session.audioReady,
  );
  const stationLabel = !agentProfileId
    ? "Calling unavailable"
    : callingReady
      ? stationPresence === "PAUSED"
        ? "Paused"
        : stationPresence === "BUSY"
          ? "On a call"
          : "Available for calls"
      : media.setupPending
        ? "Starting calling"
        : "Calling is off";
  const stationDescription = canonicalSessionError
    ? "We could not connect your calling status. Try again."
    : !agentProfileId
      ? "Calling is not configured for this login."
      : callingReady
        ? "Ready for incoming and outbound calls."
        : "Allow microphone and browser audio to start calling.";
  const outboundHelp = !actionsEnabled
    ? "Calling is temporarily unavailable."
    : activeCall
      ? "Finish the current call before starting another."
      : !callingReady
        ? "Start taking calls before placing an outbound call."
        : stationPresence !== "AVAILABLE"
          ? "Set your status to Available to place a call."
          : !selectedNumberId
            ? "No outbound caller number is configured."
            : "Enter a patient number to begin.";
  const canStartOutbound = Boolean(
    actionsEnabled &&
    session?.presence === "AVAILABLE" &&
    session.connectionState === "READY" &&
    !session.currentCallId &&
    !session.offeredCallId &&
    selectedNumberId &&
    destination.trim() &&
    !startingOutbound,
  );

  return (
    <div className="space-y-4">
      {!actionsEnabled ? (
        <section
          aria-label="Calling unavailable"
          className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Calling is temporarily unavailable.</p>
            <p className="mt-0.5 text-amber-900/75">
              Existing calls remain visible and follow-ups can still be reviewed.
            </p>
          </div>
        </section>
      ) : null}

      {actionError || media.error || media.setupError ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {actionError || media.error || media.setupError}
        </p>
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
                  const operation =
                    session && match
                      ? selectLatestClaimOperation(state.operations, {
                          agentSessionId: session.id,
                          callId: call.id,
                          endpointId: session.endpointId,
                          legId: match.leg.id,
                        })
                      : null;
                  const connecting = operation && operation.status !== "FAILED";
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
                          {operation?.status === "FAILED"
                            ? "Could not answer. Try again."
                            : connecting
                              ? "Connecting…"
                              : match
                                ? "Ringing"
                                : "Preparing"}
                        </p>
                      </div>
                      <Button
                        className="w-fit"
                        disabled={
                          !actionsEnabled || !session || !match || Boolean(connecting)
                        }
                        onClick={() => void takeCall(call)}
                        size="sm"
                        variant="primary"
                      >
                        {connecting ? "Taking" : "Take"}
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
            actionsEnabled={actionsEnabled}
            calls={state.calls}
            historyHref={historyHref}
            onResolve={(call) => void saveDisposition(call, "RESOLVED")}
            recentCalls={recentCalls}
            submittingDisposition={submittingDisposition}
            tasks={state.tasks}
          />
        </div>

        <div className="scroll-mt-4 space-y-3" id="softphone">
          <section className="rounded-xl border border-[var(--portal-border)] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--portal-ink)]">
                Station console
              </h2>
              <PortalBadge
                className={
                  state.connection === "CONNECTED"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    state.connection === "CONNECTED" ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                {state.connection === "CONNECTED" ? "Queue live" : "Queue reconnecting"}
              </PortalBadge>
            </div>

            {callingReady ? (
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {(["AVAILABLE", "PAUSED"] as const).map((option) => (
                  <Button
                    aria-pressed={stationPresence === option}
                    disabled={Boolean(session?.currentCallId || session?.offeredCallId)}
                    key={option}
                    onClick={() => setPresence(option)}
                    size="sm"
                    variant={stationPresence === option ? "primary" : "secondary"}
                  >
                    {option === "AVAILABLE" ? "Available" : "Paused"}
                  </Button>
                ))}
              </div>
            ) : (
              <Button
                className="mt-3 w-full"
                disabled={!agentProfileId || media.setupPending}
                onClick={() => void media.prepare()}
                size="sm"
                variant="secondary"
              >
                <Headphones className="h-4 w-4" aria-hidden="true" />
                {media.setupPending ? "Enabling" : "Enable calling"}
              </Button>
            )}
            <p className="mt-2 text-xs leading-relaxed text-[var(--portal-muted)]">
              {state.connection === "RECONNECTING"
                ? "Trying to reconnect. New calls may be delayed."
                : `${stationLabel}. ${stationDescription}`}
            </p>
          </section>

          {eligibleOutboundNumbers.length > 1 ? (
            <section className="rounded-xl border border-[var(--portal-border)] bg-white p-4 shadow-sm">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-[var(--portal-ink)]">
                Outbound number
                <PortalSelect
                  disabled={!eligibleOutboundNumbers.length}
                  onChange={(event) => setNumberChoice(event.target.value)}
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
              <PortalBadge
                className={
                  activeCall
                    ? "border-[var(--portal-accent)] bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]"
                    : callingReady
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-[var(--portal-border)] bg-[var(--portal-panel-soft)] text-[var(--portal-muted)]"
                }
              >
                {activeCall ? "On call" : callingReady ? "Ready" : "Setup needed"}
              </PortalBadge>
            </div>

            <div className="space-y-4 p-4">
              {activeCall ? (
                <CanonicalActiveCall
                  actionsEnabled={actionsEnabled}
                  call={activeCall}
                  endpointId={agentProfileId}
                  key={activeCall.id}
                  media={media}
                  onTakeTransfer={takeTransfer}
                  onTransfer={transferActiveCall}
                  operations={state.operations}
                  sessionId={session?.id ?? null}
                  transferTargets={state.transferTargets}
                  transferTakeCandidate={transferTakeCandidate}
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
              <audio ref={media.remoteAudioRef} autoPlay className="hidden" playsInline />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function CanonicalActiveCall({
  actionsEnabled,
  call,
  endpointId,
  media,
  onTakeTransfer,
  onTransfer,
  operations,
  sessionId,
  transferTargets,
  transferTakeCandidate,
}: {
  actionsEnabled: boolean;
  call: CallView;
  endpointId: string;
  media: ReturnType<typeof useSoftphoneMedia>;
  onTakeTransfer: () => Promise<void>;
  onTransfer: (call: CallView, targetUserId: string) => Promise<void>;
  operations: readonly OperationView[] | null;
  sessionId: string | null;
  transferTargets: TransferTargetView[];
  transferTakeCandidate: ReturnType<typeof selectCanonicalTransferTakeCandidate>;
}) {
  const [targetChoice, setTargetChoice] = useState("");
  const [callDuration, setCallDuration] = useState(0);
  const [controlError, setControlError] = useState<string | null>(null);
  const [controlPending, setControlPending] = useState<"end" | "hold" | null>(null);
  const [isHeld, setHeld] = useState(false);
  const [isMuted, setMuted] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const match = sessionId
    ? selectCanonicalBrowserMediaLeg(call, sessionId, endpointId, media.observations)
    : null;
  const localSession = sessionId ? { endpointId, id: sessionId } : null;
  const source = localSession ? selectCanonicalTransferSource(call, localSession) : null;
  const selectedTargetId = transferTargets.some(({ userId }) => userId === targetChoice)
    ? targetChoice
    : (transferTargets[0]?.userId ?? "");
  const transferOperation =
    source && selectedTargetId
      ? selectLatestTransferOperation(operations, {
          callId: call.id,
          sourceLegId: source.id,
          targetUserId: selectedTargetId,
        })
      : null;
  const canEnd = Boolean(
    match && (match.leg.status === "BRIDGED" || match.observation.state === "ACTIVE"),
  );
  const targetTransfer =
    transferTakeCandidate?.call.id === call.id ? transferTakeCandidate : null;
  const phone = formatPhone(callPhone(call));
  const connected = call.status === "CONNECTED" && !targetTransfer;
  const mediaLegId = match?.observation.mediaLegId ?? null;
  const observedHeld = match?.observation.state === "HELD";
  const controlsEnabled = Boolean(actionsEnabled && canEnd && mediaLegId);

  useEffect(() => {
    setHeld(observedHeld);
  }, [mediaLegId, observedHeld]);

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

  const showControlError = (error: unknown, fallback: string) => {
    setControlError(error instanceof Error ? error.message : fallback);
  };

  const toggleMute = () => {
    if (!mediaLegId) return;

    try {
      media.mute(mediaLegId, !isMuted);
      setMuted((current) => !current);
      setControlError(null);
    } catch (error) {
      showControlError(error, "We could not update mute. Try again.");
    }
  };

  const toggleHold = async () => {
    if (!mediaLegId || controlPending) return;

    const requestedHeld = !isHeld;
    setControlPending("hold");
    try {
      const updated = await media.hold(mediaLegId, requestedHeld);
      if (updated === false) {
        throw new Error("We could not update hold. Try again.");
      }
      setHeld(requestedHeld);
      setControlError(null);
    } catch (error) {
      showControlError(error, "We could not update hold. Try again.");
    } finally {
      setControlPending(null);
    }
  };

  const endCall = async () => {
    if (!mediaLegId || controlPending) return;

    setControlPending("end");
    try {
      await media.hangup(mediaLegId);
      setControlError(null);
    } catch (error) {
      showControlError(error, "We could not end this call. Try again.");
      setControlPending(null);
    }
  };

  const sendDigit = (digit: string) => {
    if (!mediaLegId || !controlsEnabled || controlPending) return;

    try {
      media.sendDtmf(mediaLegId, digit);
      setControlError(null);
    } catch (error) {
      showControlError(error, "We could not send that keypad tone. Try again.");
    }
  };

  const transferControls = source ? (
    <div className="mt-3 rounded-md border border-[var(--portal-border)] bg-white p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Transfer station</span>
          <PortalSelect
            disabled={!actionsEnabled || transferTargets.length === 0}
            onChange={(event) => setTargetChoice(event.target.value)}
            value={selectedTargetId}
          >
            {transferTargets.length ? (
              transferTargets.map((target) => (
                <option key={target.userId} value={target.userId}>
                  {target.name}
                </option>
              ))
            ) : (
              <option value="">No stations available</option>
            )}
          </PortalSelect>
        </label>
        <Button
          disabled={!actionsEnabled || !selectedTargetId || Boolean(transferOperation)}
          onClick={() => void onTransfer(call, selectedTargetId)}
          variant="secondary"
        >
          <PhoneForwarded className="h-4 w-4" aria-hidden="true" />
          {transferOperation?.status === "FAILED"
            ? "Transfer failed"
            : transferOperation
              ? "Transferring"
              : "Transfer"}
        </Button>
      </div>
      {transferOperation ? (
        <p
          className={`mt-2 text-xs ${transferOperation.status === "FAILED" ? "text-[var(--portal-danger)]" : "text-[var(--portal-muted)]"}`}
        >
          {transferOperation.status === "FAILED"
            ? "The transfer could not be completed. Try again."
            : `Transfer ${transferOperation.status.toLowerCase()}`}
        </p>
      ) : transferTargets.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--portal-muted)]">
          No other staff member is available for transfer.
        </p>
      ) : null}
    </div>
  ) : null;

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

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button
            aria-pressed={isMuted}
            disabled={!controlsEnabled || Boolean(controlPending)}
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
            aria-pressed={isHeld}
            disabled={!controlsEnabled || Boolean(controlPending)}
            onClick={() => void toggleHold()}
            variant={isHeld ? "default" : "secondary"}
          >
            {isHeld ? (
              <Play className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Pause className="h-4 w-4" aria-hidden="true" />
            )}
            {controlPending === "hold" ? "Updating" : isHeld ? "Resume" : "Hold"}
          </Button>
          <Button
            aria-expanded={showKeypad}
            disabled={!controlsEnabled || Boolean(controlPending)}
            onClick={() => setShowKeypad((current) => !current)}
            variant={showKeypad ? "default" : "secondary"}
          >
            <Grid3X3 className="h-4 w-4" aria-hidden="true" />
            Keypad
          </Button>
          <Button
            disabled={!controlsEnabled || Boolean(controlPending)}
            onClick={() => void endCall()}
            variant="secondary"
          >
            <PhoneOff className="h-4 w-4" aria-hidden="true" />
            {controlPending === "end" ? "Ending" : "End"}
          </Button>
        </div>

        {showKeypad ? (
          <div className="mt-4 grid max-w-60 grid-cols-3 gap-2">
            {keypadDigits.map((digit) => (
              <Button
                disabled={!controlsEnabled || Boolean(controlPending)}
                key={digit}
                onClick={() => sendDigit(digit)}
                variant="secondary"
              >
                {digit}
              </Button>
            ))}
          </div>
        ) : null}

        {transferControls}
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
          {targetTransfer ? (
            <Button
              disabled={
                !actionsEnabled ||
                !["RINGING", "CONNECTING"].includes(targetTransfer.observation.state)
              }
              onClick={() => void onTakeTransfer()}
              size="sm"
              variant="primary"
            >
              Take transfer
            </Button>
          ) : null}
          <Button
            disabled={!actionsEnabled || !canEnd}
            onClick={() => match && media.hangup(match.observation.mediaLegId)}
            size="sm"
            variant="secondary"
          >
            <PhoneOff className="h-4 w-4" aria-hidden="true" />
            End
          </Button>
        </div>
      </div>

      {source ? (
        transferControls
      ) : targetTransfer ? (
        <p className="mt-3 text-xs text-[var(--portal-muted)]">
          A transferred call is ringing now.
        </p>
      ) : null}
    </div>
  );
}

function CanonicalActivity({
  actionsEnabled,
  calls,
  historyHref,
  onResolve,
  recentCalls,
  submittingDisposition,
  tasks,
}: {
  actionsEnabled: boolean;
  calls: CallView[];
  historyHref: string;
  onResolve: (call: CallView) => void;
  recentCalls: CallView[];
  submittingDisposition: string | null;
  tasks: TaskView[];
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);

  return (
    <>
      <section className="overflow-hidden rounded-xl border border-[var(--portal-border)] bg-white shadow-sm">
        <header className="border-b border-[var(--portal-border)] px-4 py-3">
          <button
            aria-expanded={actionsOpen}
            className="flex w-full min-w-0 items-center gap-2 text-left"
            onClick={() => setActionsOpen((current) => !current)}
            type="button"
          >
            {actionsOpen ? (
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
                  Needs action
                </span>
                {tasks.length ? (
                  <PortalBadge className="px-2 py-0.5 tabular-nums">
                    {tasks.length}
                  </PortalBadge>
                ) : null}
              </span>
              <span className="mt-0.5 block text-xs text-[var(--portal-muted)]">
                Missed calls, voicemails, and notes that still need a response.
              </span>
            </span>
          </button>
        </header>

        {!actionsOpen ? null : tasks.length ? (
          <ul className="max-h-72 divide-y divide-[var(--portal-border)] overflow-y-auto">
            {tasks.map((task) => {
              const TaskIcon = task.kind === "VOICEMAIL" ? Voicemail : PhoneMissed;
              const call = task.callId
                ? calls.find(({ id }) => id === task.callId)
                : null;

              return (
                <li
                  className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                  key={task.id}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--portal-panel-soft)] text-[var(--portal-accent)]">
                      <TaskIcon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--portal-ink)]">
                        {followUpLabel(task.kind)}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-[var(--portal-muted)]">
                        {task.callerPhone
                          ? formatPhone(task.callerPhone)
                          : "Patient call"}
                        {` · ${formatRelativeTime(task.createdAt)}`}
                      </p>
                    </div>
                  </div>
                  {call ? (
                    <Button
                      className="w-fit"
                      disabled={!actionsEnabled || submittingDisposition === task.callId}
                      onClick={() => onResolve(call)}
                      size="sm"
                      variant="secondary"
                    >
                      {submittingDisposition === task.callId ? "Saving…" : "Mark done"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-[var(--portal-muted)]">
            No items need action.
          </div>
        )}
      </section>

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

function followUpLabel(kind: TaskView["kind"]) {
  switch (kind) {
    case "CALLBACK":
      return "Callback requested";
    case "FOLLOW_UP":
      return "Patient follow-up";
    case "MISSED_CALL":
      return "Missed call";
    case "VOICEMAIL":
      return "New voicemail";
  }
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

function CanonicalUnavailable({ message }: { message: string }) {
  return (
    <Card className="items-center gap-3 rounded-2xl bg-white px-6 py-10 text-center shadow-sm ring-[var(--portal-border)]">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--portal-panel-soft)] text-[var(--portal-accent)]">
        <Headphones className="h-5 w-5" aria-hidden="true" />
      </div>
      <p className="max-w-md text-sm leading-relaxed text-[var(--portal-muted)]">
        {message}
      </p>
    </Card>
  );
}
