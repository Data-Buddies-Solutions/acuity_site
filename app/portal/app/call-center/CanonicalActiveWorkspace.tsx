"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CirclePause,
  Headphones,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Voicemail,
} from "lucide-react";

import { PortalBadge } from "@/app/portal/app/PortalBadge";
import { PortalSelect } from "@/app/portal/app/PortalFields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CanonicalOutboundNumber } from "@/lib/call-center/application/portal-canonical-workspace";
import {
  selectActiveCall,
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
  outboundNumbers: CanonicalOutboundNumber[];
  queueId: string | null;
};

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
      outboundNumbers={outboundNumbers}
      queueId={queueId}
    />
  );
}

function ConnectedCanonicalActiveWorkspace({
  actionsEnabled,
  clientInstanceId,
  outboundNumbers,
  queueId,
}: {
  actionsEnabled: boolean;
  clientInstanceId: string;
  outboundNumbers: CanonicalOutboundNumber[];
  queueId: string;
}) {
  const realtime = useCanonicalCallCenter({ clientInstanceId, queueId });
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

  const session = projectedSession;

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
    state?.calls.find(({ id }) => id === session?.currentCallId) ??
    (state ? selectActiveCall(state) : null);
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
        if (!response.ok) {
          throw new Error("We could not transfer this call. Try again.");
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
          expectedSessionStateVersion: session.stateVersion,
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
        from?: unknown;
        to?: unknown;
      } | null;
      if (
        !response.ok ||
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

  return (
    <div className="space-y-5">
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

      <section
        aria-label="Calling status"
        className="flex flex-col gap-4 rounded-2xl border border-[var(--portal-border)] bg-white px-4 py-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              callingReady
                ? "bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]"
                : "bg-[var(--portal-panel-soft)] text-[var(--portal-muted)]"
            }`}
          >
            {callingReady ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ) : stationPresence === "PAUSED" ? (
              <CirclePause className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Headphones className="h-4 w-4" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-[var(--portal-ink)]">
                {stationLabel}
              </p>
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
                {state.connection === "CONNECTED" ? "Live" : "Reconnecting"}
              </PortalBadge>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--portal-muted)]">
              {state.connection === "RECONNECTING"
                ? "Trying to reconnect. New calls may be delayed."
                : stationDescription}
            </p>
          </div>
        </div>

        {callingReady ? (
          <PortalSelect
            aria-label="Calling status"
            className="sm:min-w-40"
            disabled={Boolean(session?.currentCallId || session?.offeredCallId)}
            onChange={(event) =>
              setPresence(event.target.value as AgentSessionView["presence"])
            }
            value={stationPresence}
            wrapperClassName="sm:w-auto"
          >
            {session?.presence === "BUSY" ? (
              <option value="BUSY">On a call</option>
            ) : null}
            <option value="AVAILABLE">Available</option>
            <option value="PAUSED">Paused</option>
          </PortalSelect>
        ) : (
          <Button
            className="w-full sm:w-auto"
            disabled={!agentProfileId || media.setupPending}
            onClick={() => void media.prepare()}
            variant="primary"
          >
            <Headphones className="h-4 w-4" aria-hidden="true" />
            {media.setupPending ? "Starting…" : "Start taking calls"}
          </Button>
        )}
      </section>

      {media.error || media.setupError ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {media.error || media.setupError}
        </p>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="gap-0 rounded-2xl bg-white py-0 shadow-sm ring-[var(--portal-border)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--portal-border)] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]">
                {activeCall ? (
                  <PhoneCall className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <PhoneIncoming className="h-4 w-4" aria-hidden="true" />
                )}
              </div>
              <div>
                <h2 className="text-base font-semibold text-[var(--portal-ink)]">
                  {activeCall ? "Current call" : "Incoming calls"}
                </h2>
                <p className="text-xs text-[var(--portal-muted)]">
                  {activeCall
                    ? "The active call stays in focus until it ends."
                    : `${state.counts.waiting} waiting · ${state.counts.active} active`}
                </p>
              </div>
            </div>
            {!activeCall ? (
              <PortalBadge tone="soft">
                {state.counts.waiting === 1
                  ? "1 caller waiting"
                  : `${state.counts.waiting} callers waiting`}
              </PortalBadge>
            ) : null}
          </div>

          <div className="min-h-[17rem] p-5">
            {actionError ? (
              <p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                {actionError}
              </p>
            ) : null}

            {activeCall ? (
              <CanonicalActiveCall
                actionsEnabled={actionsEnabled}
                call={activeCall}
                endpointId={agentProfileId}
                media={media}
                onTakeTransfer={takeTransfer}
                onTransfer={transferActiveCall}
                operations={state.operations}
                sessionId={session?.id ?? null}
                transferTargets={state.transferTargets}
                transferTakeCandidate={transferTakeCandidate}
              />
            ) : incomingCalls.length ? (
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
                      className="flex flex-col gap-4 rounded-xl border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] p-4 sm:flex-row sm:items-center sm:justify-between"
                      key={call.id}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[var(--portal-accent)] shadow-sm">
                          <PhoneIncoming className="h-4 w-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--portal-ink)]">
                            {call.callerName || phone}
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--portal-muted)]">
                            {call.callerName ? `${phone} · ` : ""}
                            {operation?.status === "FAILED"
                              ? "Could not answer. Try again."
                              : connecting
                                ? "Connecting…"
                                : match
                                  ? "Ringing now"
                                  : "Preparing this call"}
                          </p>
                        </div>
                      </div>
                      <Button
                        className="w-full sm:w-auto"
                        disabled={
                          !actionsEnabled || !session || !match || Boolean(connecting)
                        }
                        onClick={() => void takeCall(call)}
                        variant="primary"
                      >
                        {connecting ? "Connecting…" : "Answer"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex min-h-[13rem] flex-col items-center justify-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]">
                  <PhoneIncoming className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="mt-4 text-sm font-semibold text-[var(--portal-ink)]">
                  Ready for incoming calls
                </p>
                <p className="mt-1 max-w-xs text-sm leading-relaxed text-[var(--portal-muted)]">
                  New calls will appear here when a patient needs the front desk.
                </p>
              </div>
            )}
          </div>
        </Card>

        <Card className="gap-0 rounded-2xl bg-white py-0 shadow-sm ring-[var(--portal-border)]">
          <div className="border-b border-[var(--portal-border)] px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]">
                <PhoneOutgoing className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[var(--portal-ink)]">
                  Call a patient
                </h2>
                <p className="text-xs text-[var(--portal-muted)]">
                  Start an outbound call.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-5">
            <label className="block">
              <span className="text-xs font-medium text-[var(--portal-muted)]">
                Patient number
              </span>
              <Input
                className="mt-1.5 h-11 text-base"
                inputMode="tel"
                onChange={(event) => setDestination(event.target.value)}
                placeholder="(555) 555-0123"
                type="tel"
                value={destination}
              />
            </label>

            {eligibleOutboundNumbers.length > 1 ? (
              <label className="block">
                <span className="text-xs font-medium text-[var(--portal-muted)]">
                  Calling from
                </span>
                <PortalSelect
                  className="mt-1.5"
                  disabled={!eligibleOutboundNumbers.length}
                  onChange={(event) => setNumberChoice(event.target.value)}
                  value={selectedNumberId}
                >
                  {eligibleOutboundNumbers.map((number) => (
                    <option key={number.id} value={number.id}>
                      {number.label} · {formatPhone(number.phoneNumber)}
                    </option>
                  ))}
                </PortalSelect>
              </label>
            ) : eligibleOutboundNumbers[0] ? (
              <div className="rounded-xl bg-[var(--portal-panel-soft)] px-3 py-2.5">
                <p className="text-[11px] font-medium text-[var(--portal-muted)]">
                  Calling from
                </p>
                <p className="mt-0.5 truncate text-sm font-medium text-[var(--portal-ink)]">
                  {eligibleOutboundNumbers[0].label} ·{" "}
                  {formatPhone(eligibleOutboundNumbers[0].phoneNumber)}
                </p>
              </div>
            ) : null}

            <Button
              className="w-full"
              disabled={
                startingOutbound ||
                !actionsEnabled ||
                !session ||
                session.presence !== "AVAILABLE" ||
                session.connectionState !== "READY" ||
                !selectedNumberId ||
                !destination.trim()
              }
              onClick={() => void startOutbound()}
              variant="primary"
            >
              <PhoneOutgoing className="h-4 w-4" aria-hidden="true" />
              {startingOutbound ? "Starting…" : "Call patient"}
            </Button>
            <p className="text-xs leading-relaxed text-[var(--portal-muted)]">
              {outboundHelp}
            </p>
          </div>
          <audio ref={media.remoteAudioRef} autoPlay className="hidden" />
        </Card>
      </div>

      <CanonicalActivity
        actionsEnabled={actionsEnabled}
        calls={state.calls}
        onResolve={(call) => void saveDisposition(call, "RESOLVED")}
        recentCalls={recentCalls}
        submittingDisposition={submittingDisposition}
        tasks={state.tasks}
      />
    </div>
  );
}

function CanonicalActiveCall({
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

  return (
    <div className="rounded-2xl bg-[#19203a] p-5 text-white shadow-[0_18px_50px_rgba(25,32,58,0.14)]">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
            <PhoneCall className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <PortalBadge className="border-white/15 bg-white/10 text-white">
              {call.status === "CONNECTED" || call.status === "WRAP_UP"
                ? "Connected"
                : "Calling"}
            </PortalBadge>
            <p className="mt-3 truncate text-xl font-semibold text-white">
              {call.callerName || phone}
            </p>
            {call.callerName ? (
              <p className="mt-1 text-sm text-white/60">{phone}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {targetTransfer ? (
            <Button
              disabled={
                !actionsEnabled ||
                !["RINGING", "CONNECTING"].includes(targetTransfer.observation.state)
              }
              onClick={() => void onTakeTransfer()}
              variant="primary"
            >
              Take transfer
            </Button>
          ) : null}
          <Button
            disabled={!actionsEnabled || !canEnd}
            onClick={() => match && media.hangup(match.observation.mediaLegId)}
            variant="destructive"
          >
            <PhoneOff className="h-4 w-4" aria-hidden="true" />
            End call
          </Button>
        </div>
      </div>

      {source ? (
        <div className="mt-5 border-t border-white/12 pt-5">
          <label className="block text-xs font-medium text-white/65">
            Transfer to
            <PortalSelect
              className="mt-1.5"
              disabled={!actionsEnabled || transferTargets.length === 0}
              onChange={(event) => setTargetChoice(event.target.value)}
              value={selectedTargetId}
            >
              {transferTargets.map((target) => (
                <option key={target.userId} value={target.userId}>
                  {target.name}
                </option>
              ))}
            </PortalSelect>
          </label>
          <Button
            className="mt-3"
            disabled={!actionsEnabled || !selectedTargetId || Boolean(transferOperation)}
            onClick={() => void onTransfer(call, selectedTargetId)}
            variant="secondary"
          >
            {transferOperation?.status === "FAILED"
              ? "Transfer failed"
              : transferOperation
                ? "Transferring"
                : "Transfer"}
          </Button>
          {transferOperation ? (
            <p
              className={`mt-2 text-xs ${transferOperation.status === "FAILED" ? "text-red-200" : "text-white/55"}`}
            >
              {transferOperation.status === "FAILED"
                ? "The transfer could not be completed. Try again."
                : `Transfer ${transferOperation.status.toLowerCase()}`}
            </p>
          ) : transferTargets.length === 0 ? (
            <p className="mt-2 text-xs text-white/55">
              No other staff member is available for transfer.
            </p>
          ) : null}
        </div>
      ) : targetTransfer ? (
        <p className="mt-4 text-xs text-white/60">A transferred call is ringing now.</p>
      ) : null}
    </div>
  );
}

function CanonicalActivity({
  actionsEnabled,
  calls,
  onResolve,
  recentCalls,
  submittingDisposition,
  tasks,
}: {
  actionsEnabled: boolean;
  calls: CallView[];
  onResolve: (call: CallView) => void;
  recentCalls: CallView[];
  submittingDisposition: string | null;
  tasks: TaskView[];
}) {
  return (
    <Card className="gap-0 rounded-2xl bg-white py-0 shadow-sm ring-[var(--portal-border)]">
      <Tabs className="gap-0" defaultValue={tasks.length ? "follow-up" : "recent"}>
        <div className="flex flex-col gap-4 border-b border-[var(--portal-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--portal-ink)]">Activity</h2>
            <p className="mt-0.5 text-xs text-[var(--portal-muted)]">
              Work that needs attention, followed by recent calls.
            </p>
          </div>
          <TabsList className="h-9" variant="default">
            <TabsTrigger className="px-3" value="follow-up">
              Follow-up
              {tasks.length ? (
                <span className="rounded-full bg-[var(--portal-accent)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                  {tasks.length}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger className="px-3" value="recent">
              Recent calls
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent className="m-0" value="follow-up">
          {tasks.length ? (
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
                        className="w-full sm:w-auto"
                        disabled={
                          !actionsEnabled || submittingDisposition === task.callId
                        }
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
            <ActivityEmptyState
              description="New missed calls and voicemails will appear here."
              title="You’re caught up"
            />
          )}
        </TabsContent>

        <TabsContent className="m-0" value="recent">
          {recentCalls.length ? (
            <ul className="max-h-72 divide-y divide-[var(--portal-border)] overflow-y-auto">
              {recentCalls.map((call) => {
                const DirectionIcon =
                  call.direction === "OUTBOUND" ? PhoneOutgoing : PhoneIncoming;
                const phone = formatPhone(callPhone(call));

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
                        <p className="truncate text-sm font-medium text-[var(--portal-ink)]">
                          {call.callerName || phone}
                        </p>
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
            <ActivityEmptyState
              description="Completed calls will appear here."
              title="No recent calls"
            />
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function ActivityEmptyState({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-5 py-8 text-center">
      <CheckCircle2 className="h-5 w-5 text-[var(--portal-accent)]" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-[var(--portal-ink)]">{title}</p>
      <p className="mt-1 text-xs text-[var(--portal-muted)]">{description}</p>
    </div>
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
