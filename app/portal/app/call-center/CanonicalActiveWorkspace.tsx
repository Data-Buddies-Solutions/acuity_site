"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PhoneOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CanonicalOutboundNumber } from "@/lib/call-center/application/portal-canonical-workspace";
import {
  selectActiveCall,
  selectIncomingCalls,
  type AgentSessionView,
  type CallView,
  type OperationView,
  type TransferTargetView,
} from "@/lib/call-center/realtime-contract";

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
    return <CanonicalUnavailable message="Call center is disabled." />;
  }
  if (!queueId) {
    return (
      <CanonicalUnavailable message="Canonical activation requires one configured queue for this location." />
    );
  }
  if (identityError) {
    return <CanonicalUnavailable message="Canonical browser identity is unavailable." />;
  }
  if (!client) return <CanonicalUnavailable message="Connecting canonical workspace…" />;

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
        setActionError("The canonical agent leg is not bound to this browser media leg.");
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
          const body = (await response.json().catch(() => null)) as {
            error?: unknown;
          } | null;
          throw new Error(
            typeof body?.error === "string" ? body.error : "Canonical Take failed",
          );
        }
        await answerMedia(match.observation.mediaLegId);
      } catch (error) {
        setCallCenterCurrentCallGuard(session.currentCallId);
        setActionError(error instanceof Error ? error.message : "Canonical Take failed");
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
        error instanceof Error ? error.message : "Canonical transfer Take failed",
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
          const body = (await response.json().catch(() => null)) as {
            error?: unknown;
          } | null;
          throw new Error(
            typeof body?.error === "string" ? body.error : "Canonical transfer failed",
          );
        }
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Canonical transfer failed",
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
        if (!response.ok) throw new Error("Canonical disposition failed");
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Canonical disposition failed",
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
        error?: unknown;
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
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "Canonical outbound call could not be started",
        );
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
          : "Canonical outbound call could not be started",
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
    return <CanonicalUnavailable message={realtime.error.message} />;
  }
  if (realtime.loading || !state) {
    return <CanonicalUnavailable message="Loading canonical queue…" />;
  }

  const readinessMessage = canonicalSessionError
    ? canonicalSessionError
    : !agentProfileId
      ? "Calling is not configured for your login."
      : session?.connectionState === "READY" &&
          session.microphoneReady &&
          session.audioReady
        ? "Ready for canonical calls."
        : "Enable calling to allow microphone and browser audio.";

  return (
    <div className="space-y-4">
      {!actionsEnabled ? (
        <section
          aria-label="Canonical rollback status"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <p className="font-semibold">Call center rollback is active</p>
          <p className="mt-1">
            Existing canonical calls remain visible, but new canonical actions are blocked.
          </p>
        </section>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="rounded-xl border border-[var(--portal-border)] bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--portal-muted)]">
                Live queue
              </p>
              <h2 className="mt-1 text-lg font-semibold text-[var(--portal-ink)]">
                {state.queue.name}
              </h2>
              <p className="mt-1 text-sm text-[var(--portal-muted)]">
                {state.counts.waiting} waiting · {state.counts.active} active
              </p>
            </div>
            <span className="text-xs text-[var(--portal-muted)]">
              {state.connection === "CONNECTED" ? "Live" : "Reconnecting"}
            </span>
          </div>

          {actionError ? (
            <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {actionError}
            </p>
          ) : null}

          <ul className="mt-5 space-y-3">
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
              return (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] p-3"
                  key={call.id}
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--portal-ink)]">
                      {call.callerName || callPhone(call)}
                    </p>
                    <p className="text-xs text-[var(--portal-muted)]">
                      {operation?.status === "FAILED"
                        ? `Take failed · ${operation.errorCode ?? "provider failure"}`
                        : connecting
                          ? "Connecting"
                          : match
                            ? "Ringing your browser"
                            : "Waiting for your canonical media leg"}
                    </p>
                  </div>
                  <Button
                    disabled={
                      !actionsEnabled || !session || !match || Boolean(connecting)
                    }
                    onClick={() => void takeCall(call)}
                    variant="primary"
                  >
                    {connecting ? "Connecting" : "Take"}
                  </Button>
                </li>
              );
            })}
            {incomingCalls.length === 0 ? (
              <li className="py-8 text-center text-sm text-[var(--portal-muted)]">
                No callers are waiting.
              </li>
            ) : null}
          </ul>

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
          ) : null}
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <section>
              <h3 className="text-sm font-semibold">Recent calls</h3>
              <ul className="mt-2 space-y-2">
                {recentCalls.map((call) => (
                  <li className="rounded-lg border p-3" key={call.id}>
                    <p className="text-sm font-medium">
                      {call.callerName || callPhone(call)}
                    </p>
                    <p className="text-xs text-[var(--portal-muted)]">{call.status}</p>
                    <Button
                      disabled={!actionsEnabled || submittingDisposition === call.id}
                      onClick={() => void saveDisposition(call, "RESOLVED")}
                      size="sm"
                      variant="secondary"
                    >
                      {submittingDisposition === call.id ? "Saving…" : "Resolve"}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="text-sm font-semibold">Open follow-up</h3>
              <ul className="mt-2 space-y-2">
                {state.tasks.map((task) => (
                  <li className="rounded-lg border p-3" key={task.id}>
                    <p className="text-sm font-medium">
                      {task.kind.replaceAll("_", " ")}
                    </p>
                    <p className="text-xs text-[var(--portal-muted)]">
                      {task.callerPhone || "Canonical call task"}
                    </p>
                    {task.callId ? (
                      <Button
                        disabled={!actionsEnabled}
                        onClick={() => {
                          const call = state.calls.find(({ id }) => id === task.callId);
                          if (call) void saveDisposition(call, "RESOLVED");
                        }}
                        size="sm"
                        variant="secondary"
                      >
                        Resolve task
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--portal-border)] bg-white p-5">
          <h2 className="text-sm font-semibold text-[var(--portal-ink)]">
            Your calling status
          </h2>
          <label className="mt-4 block text-xs font-semibold text-[var(--portal-muted)]">
            Presence
            <select
              className="mt-1 h-10 w-full rounded-lg border border-[var(--portal-border)] bg-white px-3 text-sm"
              disabled={Boolean(session?.currentCallId || session?.offeredCallId)}
              onChange={(event) =>
                setPresence(event.target.value as AgentSessionView["presence"])
              }
              value={session?.presence ?? presence}
            >
              {session?.presence === "BUSY" ? <option value="BUSY">Busy</option> : null}
              <option value="AVAILABLE">Available</option>
              <option value="PAUSED">Paused</option>
            </select>
          </label>
          <Button
            className="mt-4 w-full"
            disabled={!agentProfileId || media.setupPending}
            onClick={() => void media.prepare()}
            variant="secondary"
          >
            {media.setupPending ? "Enabling…" : "Enable calling"}
          </Button>
          <p className="mt-3 text-sm text-[var(--portal-muted)]">{readinessMessage}</p>
          {media.error || media.setupError ? (
            <p className="mt-2 text-sm text-red-700">{media.error || media.setupError}</p>
          ) : null}
          <div className="mt-6 border-t border-[var(--portal-border)] pt-5">
            <h3 className="text-sm font-semibold text-[var(--portal-ink)]">
              Outbound call
            </h3>
            <label className="mt-3 block text-xs font-semibold text-[var(--portal-muted)]">
              Caller ID
              <select
                className="mt-1 h-10 w-full rounded-lg border border-[var(--portal-border)] bg-white px-3 text-sm"
                disabled={!eligibleOutboundNumbers.length}
                onChange={(event) => setNumberChoice(event.target.value)}
                value={selectedNumberId}
              >
                {eligibleOutboundNumbers.map((number) => (
                  <option key={number.id} value={number.id}>
                    {number.label} · {number.phoneNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs font-semibold text-[var(--portal-muted)]">
              Patient number
              <Input
                className="mt-1"
                inputMode="tel"
                onChange={(event) => setDestination(event.target.value)}
                placeholder="(555) 555-0123"
                type="tel"
                value={destination}
              />
            </label>
            <Button
              className="mt-3 w-full"
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
              {startingOutbound ? "Starting…" : "Call patient"}
            </Button>
          </div>
          <audio ref={media.remoteAudioRef} autoPlay className="hidden" />
        </section>
      </div>
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
  return (
    <div className="mt-5 rounded-lg border border-[var(--portal-border)] p-4">
      <p className="text-sm font-semibold text-[var(--portal-ink)]">
        {call.status === "CONNECTED" || call.status === "WRAP_UP"
          ? "Connected"
          : "Calling"}{" "}
        · {call.callerName || callPhone(call)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={!actionsEnabled || !canEnd}
          onClick={() => match && media.hangup(match.observation.mediaLegId)}
          variant="secondary"
        >
          <PhoneOff className="h-4 w-4" aria-hidden="true" />
          End
        </Button>
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
      </div>
      {source ? (
        <div className="mt-4 border-t border-[var(--portal-border)] pt-4">
          <label className="block text-xs font-semibold text-[var(--portal-muted)]">
            Transfer to
            <select
              className="mt-1 h-10 w-full rounded-lg border border-[var(--portal-border)] bg-white px-3 text-sm"
              disabled={!actionsEnabled || transferTargets.length === 0}
              onChange={(event) => setTargetChoice(event.target.value)}
              value={selectedTargetId}
            >
              {transferTargets.map((target) => (
                <option key={target.userId} value={target.userId}>
                  {target.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="mt-2"
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
              className={`mt-2 text-xs ${transferOperation.status === "FAILED" ? "text-red-700" : "text-[var(--portal-muted)]"}`}
            >
              {transferOperation.status === "FAILED"
                ? `Transfer failed · ${transferOperation.errorCode ?? "provider failure"}`
                : `Transfer ${transferOperation.status.toLowerCase()}`}
            </p>
          ) : transferTargets.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--portal-muted)]">
              No other configured agent is available for transfer.
            </p>
          ) : null}
        </div>
      ) : targetTransfer ? (
        <p className="mt-3 text-xs text-[var(--portal-muted)]">
          Transfer from the connected agent is ringing your browser.
        </p>
      ) : null}
    </div>
  );
}

function callPhone(call: CallView) {
  return call.direction === "OUTBOUND" ? call.toPhone : call.fromPhone;
}

function CanonicalUnavailable({ message }: { message: string }) {
  return (
    <section className="rounded-xl border border-[var(--portal-border)] bg-white p-6 text-sm text-[var(--portal-muted)]">
      {message}
    </section>
  );
}
