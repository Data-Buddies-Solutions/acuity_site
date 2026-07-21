"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Delete,
  Grip,
  Headphones,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneForwarded,
  PhoneOff,
  Play,
} from "lucide-react";

import { PortalBadge } from "@/app/portal/app/PortalBadge";
import { PortalSelect } from "@/app/portal/app/PortalFields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CanonicalOutboundNumber } from "@/lib/call-center/application/portal-canonical-workspace";
import { CallCenterRequestError } from "@/lib/call-center/operator-error";
import type { AgentAvailabilityIntent } from "@/lib/call-center/domain/agent-session-readiness";
import {
  selectLiveCallOwnership,
  selectLiveQueueCalls,
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
import {
  canonicalOutboundIdempotencyKey,
  completeCanonicalOutboundOperation,
  failCanonicalOutboundOperation,
  hasCanonicalPendingTransfer,
  hasCanonicalSessionLiveLeg,
  isDefinitiveCanonicalOutboundFailure,
  isCanonicalTransferOffer,
  reconcileCanonicalOutboundRuntime,
  selectCanonicalAgentActiveCall,
  selectCanonicalBrowserMediaLeg,
  selectCanonicalTransferOffers,
} from "./canonical-active-call-center";
import { CallConnectionStatus } from "./CallConnectionStatus";
import FollowUpPreview from "./FollowUpPreview";
import type { MediaConnectionState } from "./softphone-media-adapter";
import { useCanonicalCallCenter } from "./use-canonical-call-center";
import { useSoftphoneMedia } from "./use-softphone";
import { useSoftphoneRuntime } from "../SoftphoneRuntime";

type CanonicalActiveWorkspaceProps = {
  agentProfileLabel: string | null;
  followUpHref: string;
  historyHref: string;
  initialDialNumber?: string | null;
  office?: string | null;
  outboundNumbers: CanonicalOutboundNumber[];
  queueId: string | null;
};

const keypadDigits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const OUTBOUND_NUMBER_STORAGE_KEY = "acuity-call-center:outbound-number-id";

function errorMessage(error: unknown, action: CallCenterAction) {
  return operatorErrorCopy(error, action).message;
}

function holdMusicMayHaveStarted(error: unknown) {
  return (
    !(error instanceof CallCenterRequestError) ||
    [
      "PROVIDER_UNAVAILABLE",
      "REQUEST_TIMEOUT",
      "TEMPORARY_SERVICE_FAILURE",
      "UNKNOWN_FAILURE",
    ].includes(error.operatorError.code)
  );
}

function isAgentSessionViewReady(session: AgentSessionView) {
  return (
    session.presence === "AVAILABLE" &&
    session.connectionState === "READY" &&
    session.microphoneReady &&
    session.audioReady
  );
}

function availabilityRecoveryMessage(
  intent: "AVAILABLE" | "PAUSED",
  occupied: boolean,
  session: AgentSessionView | null,
  media: Pick<
    ReturnType<typeof useSoftphoneMedia>,
    "connection" | "microphoneReady" | "soundReady"
  >,
) {
  if (intent !== "AVAILABLE" || occupied || !session) {
    return null;
  }
  if (media.connection !== "READY") {
    return "Restore the phone connection to become Available.";
  }
  if (!media.microphoneReady) {
    return "Allow microphone access to become Available.";
  }
  if (!media.soundReady) {
    return "Allow browser audio to become Available.";
  }
  return null;
}

function AvailabilityControl({
  error,
  occupied,
  onChange,
  onRetry,
  pending,
  presence,
  recoveryMessage,
}: {
  error: string | null;
  occupied: boolean;
  onChange: (presence: AgentAvailabilityIntent) => Promise<void>;
  onRetry: (() => void) | null;
  pending: boolean;
  presence: AgentSessionView["presence"];
  recoveryMessage: string | null;
}) {
  const selected = occupied || presence === "BUSY" || recoveryMessage ? null : presence;

  return (
    <div className="space-y-2 border-b border-[var(--portal-border)] px-4 py-4">
      <p className="text-xs font-medium text-[var(--portal-muted)]">Availability</p>
      <div aria-label="Availability" className="grid grid-cols-2 gap-2" role="group">
        <Button
          aria-pressed={selected === "AVAILABLE"}
          disabled={occupied || pending}
          onClick={() => void onChange("AVAILABLE").catch(() => {})}
          type="button"
          variant={selected === "AVAILABLE" ? "primary" : "secondary"}
        >
          Available
        </Button>
        <Button
          aria-pressed={selected === "PAUSED"}
          disabled={occupied || pending}
          onClick={() => void onChange("PAUSED").catch(() => {})}
          type="button"
          variant={selected === "PAUSED" ? "primary" : "secondary"}
        >
          Unavailable
        </Button>
      </div>
      {occupied ? (
        <p className="text-xs font-medium text-[var(--portal-muted)]" role="status">
          On a call
        </p>
      ) : pending ? (
        <p className="text-xs text-[var(--portal-muted)]" role="status">
          Updating availability…
        </p>
      ) : recoveryMessage ? (
        <p className="text-xs text-[var(--portal-muted)]" role="status">
          {recoveryMessage}
        </p>
      ) : null}
      {error ? (
        <div className="flex items-center justify-between gap-3" role="alert">
          <p className="text-xs text-red-700">{error}</p>
          {onRetry ? (
            <Button
              disabled={occupied || pending}
              onClick={onRetry}
              size="sm"
              type="button"
              variant="secondary"
            >
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatCallDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainingSeconds = (seconds % 60).toString().padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

type InboundAnswerClaimWire =
  | { replayed: boolean; reservation: { id: string }; status: "ACCEPTED" }
  | { reason: string; status: "REJECTED" };

export function CanonicalOfferAnswerButton({
  answer,
  answering,
  callId,
  connectionState,
  disabled,
  legId,
  mediaLegId,
  sessionId,
  transferOffer = false,
}: {
  answer(mediaLegId: string): Promise<void>;
  answering: boolean;
  callId: string;
  connectionState: MediaConnectionState;
  disabled: boolean;
  legId: string;
  mediaLegId: string;
  sessionId: string;
  transferOffer?: boolean;
}) {
  const [answerPending, setAnswerPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const keyRef = useRef<{ key: string; scope: string } | null>(null);
  const reservationRef = useRef<{
    body: { legId: string; sessionId: string };
    idempotencyKey: string;
  } | null>(null);

  const releaseClaim = useCallback(
    (failureCode: "BROWSER_ANSWER_FAILED" | "BROWSER_DISCONNECTED") => {
      const claimed = reservationRef.current;
      if (!claimed) return Promise.resolve();
      reservationRef.current = null;
      if (keyRef.current?.key === claimed.idempotencyKey) keyRef.current = null;
      return fetch(`/api/portal/call-center/calls/${callId}/answer`, {
        body: JSON.stringify({ ...claimed.body, failureCode }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": claimed.idempotencyKey,
        },
        keepalive: true,
        method: "DELETE",
      }).then(() => undefined);
    },
    [callId],
  );

  useEffect(() => {
    const releaseDisconnectedClaim = () => {
      void releaseClaim("BROWSER_DISCONNECTED");
    };
    window.addEventListener("pagehide", releaseDisconnectedClaim);
    return () => {
      window.removeEventListener("pagehide", releaseDisconnectedClaim);
      releaseDisconnectedClaim();
    };
  }, [releaseClaim]);

  useEffect(() => {
    if (connectionState === "FAILED" || connectionState === "OFFLINE") {
      void releaseClaim("BROWSER_DISCONNECTED");
    }
  }, [connectionState, releaseClaim]);

  const answerOffer = useCallback(async () => {
    if (answerPending) return;
    setAnswerPending(true);
    setFailure(null);
    if (transferOffer) {
      try {
        await answer(mediaLegId);
      } catch (error) {
        setFailure(errorMessage(error, "answer"));
      } finally {
        setAnswerPending(false);
      }
      return;
    }
    const scope = `${callId}:${legId}:${sessionId}`;
    const idempotencyKey =
      keyRef.current?.scope === scope
        ? keyRef.current.key
        : `canonical-answer:${scope}:${crypto.randomUUID()}`;
    keyRef.current = { key: idempotencyKey, scope };
    const body = { legId, sessionId };
    let accepted = false;
    try {
      const response = await fetch(`/api/portal/call-center/calls/${callId}/answer`, {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        method: "POST",
      });
      const result = await response
        .clone()
        .json()
        .catch(() => null);
      if ((result as InboundAnswerClaimWire | null)?.status === "REJECTED") {
        if (keyRef.current?.key === idempotencyKey) keyRef.current = null;
        throw localCallCenterError("CALL_NOT_CONNECTED", false);
      }
      await callCenterResponse<InboundAnswerClaimWire>(response);
      accepted = true;
      reservationRef.current = { body, idempotencyKey };
      await answer(mediaLegId);
    } catch (error) {
      if (accepted) {
        await releaseClaim("BROWSER_ANSWER_FAILED").catch(() => undefined);
      }
      setFailure(errorMessage(error, "answer"));
    } finally {
      setAnswerPending(false);
    }
  }, [
    answer,
    answerPending,
    callId,
    legId,
    mediaLegId,
    releaseClaim,
    sessionId,
    transferOffer,
  ]);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={disabled || answerPending}
        onClick={() => void answerOffer()}
        size="sm"
        variant="primary"
      >
        {answering || answerPending ? "Answering" : "Answer"}
      </Button>
      {failure ? (
        <span className="max-w-48 text-right text-xs text-red-700" role="alert">
          {failure}
        </span>
      ) : null}
    </div>
  );
}

export function CanonicalActiveWorkspace({
  agentProfileLabel,
  followUpHref,
  historyHref,
  initialDialNumber,
  office,
  outboundNumbers,
  queueId,
}: CanonicalActiveWorkspaceProps) {
  const runtime = useSoftphoneRuntime();

  if (!queueId) {
    return (
      <CanonicalUnavailable
        connectionState={runtime.media.connection}
        message="Calling is not configured for this location."
      />
    );
  }
  if (runtime.error && !runtime.clientInstanceId) {
    return (
      <CanonicalUnavailable
        connectionState={runtime.media.connection}
        message={runtime.error}
      />
    );
  }
  if (!runtime.clientInstanceId) {
    return (
      <CanonicalUnavailable
        connectionState={runtime.media.connection}
        message="Connecting to the call center…"
      />
    );
  }

  return (
    <ConnectedCanonicalActiveWorkspace
      agentProfileLabel={agentProfileLabel}
      clientInstanceId={runtime.clientInstanceId}
      followUpHref={followUpHref}
      historyHref={historyHref}
      initialDialNumber={initialDialNumber}
      office={office}
      outboundNumbers={outboundNumbers}
      queueId={queueId}
    />
  );
}

function ConnectedCanonicalActiveWorkspace({
  agentProfileLabel,
  clientInstanceId,
  followUpHref,
  historyHref,
  initialDialNumber,
  office,
  outboundNumbers,
  queueId,
}: {
  agentProfileLabel: string | null;
  clientInstanceId: string;
  followUpHref: string;
  historyHref: string;
  initialDialNumber?: string | null;
  office?: string | null;
  outboundNumbers: CanonicalOutboundNumber[];
  queueId: string;
}) {
  const runtime = useSoftphoneRuntime();
  const setOutboundOperationActive = runtime.setOutboundOperationActive;
  const realtime = useCanonicalCallCenter({ queueId });
  const refreshSnapshot = realtime.refetch;
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedCallId, setCopiedCallId] = useState<string | null>(null);
  const [destination, setDestination] = useState(initialDialNumber ?? "");
  const [numberChoice, setNumberChoice] = useState("");
  const [startingOutbound, setStartingOutbound] = useState(false);
  const canonicalOutboundAwaitingSnapshotRef = useRef<string | null>(null);
  const canonicalOutboundCallIdRef = useRef<string | null>(null);
  const canonicalOutboundObservedRef = useRef(false);
  const canonicalSnapshotObservedAtRef = useRef<string | null>(null);
  const outboundStartingRef = useRef(false);

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

  const eligibleOutboundNumbers = outboundNumbers;
  const selectedNumberId = eligibleOutboundNumbers.some(({ id }) => id === numberChoice)
    ? numberChoice
    : (eligibleOutboundNumbers[0]?.id ?? "");
  const selectedOutboundNumber = eligibleOutboundNumbers.find(
    ({ id }) => id === selectedNumberId,
  );
  const state = realtime.state;
  const session = runtime.session;
  const media = runtime.media;
  const { observations: mediaObservations } = media;

  useEffect(() => {
    canonicalSnapshotObservedAtRef.current = state?.observedAt ?? null;
  }, [state?.observedAt]);

  const liveQueueCalls = useMemo(() => {
    if (!state) return [];
    const selectedQueueCalls = selectLiveQueueCalls(state);
    const transfers = selectCanonicalTransferOffers(state.calls, session);
    return [
      ...selectedQueueCalls,
      ...transfers.filter((call) => !selectedQueueCalls.some(({ id }) => id === call.id)),
    ].filter((call) => selectLiveCallOwnership(call) !== null);
  }, [session, state]);
  const activeCall = selectCanonicalAgentActiveCall(state?.calls ?? [], session);
  const hasActiveOutboundCall = activeCall?.direction === "OUTBOUND";
  const localOffer = session
    ? liveQueueCalls.find((call) =>
        selectCanonicalBrowserMediaLeg(
          call,
          session.id,
          session.endpointId,
          mediaObservations,
        ),
      )
    : null;
  const canonicalOffer = hasCanonicalSessionLiveLeg(liveQueueCalls, session);
  const availabilityOccupied = Boolean(
    activeCall ||
    localOffer ||
    canonicalOffer ||
    runtime.answeringMediaLegId ||
    session?.presence === "BUSY",
  );
  const availabilityRecovery = availabilityRecoveryMessage(
    runtime.availabilityIntent,
    availabilityOccupied,
    session,
    media,
  );

  const callingReady = Boolean(
    session && !availabilityRecovery && isAgentSessionViewReady(session),
  );

  const copyPhone = async (callId: string, phone: string) => {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(phone);
      setCopiedCallId(callId);
    } catch {
      setCopiedCallId((current) => (current === callId ? null : current));
      setActionError("Phone number could not be copied. Try again.");
    }
  };

  useEffect(() => {
    setCallCenterCurrentCallGuard(activeCall?.id ?? localOffer?.id ?? null);
  }, [activeCall?.id, localOffer?.id]);

  useEffect(() => {
    if (!state && !startingOutbound) return;
    const awaitingSnapshotObservedAt = canonicalOutboundAwaitingSnapshotRef.current;
    const next = reconcileCanonicalOutboundRuntime({
      awaitingFreshSnapshot: awaitingSnapshotObservedAt !== null,
      canonicalCallId: canonicalOutboundCallIdRef.current,
      canonicalCallObserved: canonicalOutboundObservedRef.current,
      canonicalCallVisible: Boolean(
        canonicalOutboundCallIdRef.current &&
        state?.calls.some(({ id }) => id === canonicalOutboundCallIdRef.current),
      ),
      freshSnapshotAvailable: Boolean(
        awaitingSnapshotObservedAt &&
        state?.observedAt &&
        state.observedAt !== awaitingSnapshotObservedAt,
      ),
      hasActiveOutboundCall,
      startingOutbound,
    });
    if (!next) return;

    canonicalOutboundAwaitingSnapshotRef.current = null;
    canonicalOutboundCallIdRef.current = next.callId;
    canonicalOutboundObservedRef.current = next.observed;
    setOutboundOperationActive(next.active);
  }, [hasActiveOutboundCall, setOutboundOperationActive, startingOutbound, state]);

  const declineCall = useCallback(
    (call: CallView) => {
      if (!session) return;
      const match = selectCanonicalBrowserMediaLeg(
        call,
        session.id,
        session.endpointId,
        mediaObservations,
      );
      if (!match) {
        setActionError("This call is no longer available.");
        return;
      }

      try {
        media.hangup(match.observation.mediaLegId);
        setActionError(null);
      } catch (error) {
        setActionError(errorMessage(error, "end"));
      }
    },
    [media, mediaObservations, session],
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
    canonicalOutboundAwaitingSnapshotRef.current = null;
    setOutboundOperationActive(true);
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
          legId?: unknown;
        }>(response);
      };
      const body = await requestOutbound();
      if (typeof body?.callId !== "string" || typeof body.legId !== "string") {
        throw localCallCenterError("OUTBOUND_CALL_FAILED");
      }
      canonicalOutboundCallIdRef.current = body.callId;
      canonicalOutboundAwaitingSnapshotRef.current =
        canonicalSnapshotObservedAtRef.current ?? state?.observedAt ?? null;
      setOutboundOperationActive(true, { callId: body.callId, legId: body.legId });
      setCallCenterCurrentCallGuard(body.callId);
      completeCanonicalOutboundOperation(window.sessionStorage, target, operationKey);
      setDestination("");
    } catch (error) {
      canonicalOutboundCallIdRef.current = null;
      canonicalOutboundObservedRef.current = false;
      if (isDefinitiveCanonicalOutboundFailure(error)) {
        canonicalOutboundAwaitingSnapshotRef.current = null;
        setOutboundOperationActive(false, undefined, {
          releaseProvisionalSuppression: true,
        });
      } else {
        canonicalOutboundAwaitingSnapshotRef.current =
          canonicalSnapshotObservedAtRef.current ?? state?.observedAt ?? null;
        setOutboundOperationActive(true);
      }
      failCanonicalOutboundOperation(window.sessionStorage, target, operationKey, error);
      setActionError(errorMessage(error, "outbound"));
    } finally {
      outboundStartingRef.current = false;
      setStartingOutbound(false);
    }
  }, [
    clientInstanceId,
    destination,
    queueId,
    selectedNumberId,
    session,
    setOutboundOperationActive,
    state,
  ]);

  if (realtime.error && !state) {
    return (
      <CanonicalUnavailable
        connectionState={runtime.media.connection}
        message={errorMessage(realtime.error, "connect")}
        retry={refreshSnapshot}
      />
    );
  }
  if (realtime.loading || !state) {
    return (
      <CanonicalUnavailable
        connectionState={runtime.media.connection}
        message="Connecting to the call center…"
      />
    );
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
        <OperatorStateWarning
          failedAt={realtime.errorAt ?? state.observedAt}
          observedAt={state.observedAt}
          retry={refreshSnapshot}
        />
      ) : null}

      {runtime.error ? (
        <section
          className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <p>
            {runtime.media.microphoneError ??
              runtime.media.error ??
              (session ? "Phone disconnected — reconnecting" : runtime.error)}
          </p>
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
          ) : runtime.media.microphoneError ? (
            <Button
              onClick={() => void runtime.media.prepare()}
              size="sm"
              variant="secondary"
            >
              Retry microphone
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
                  Calls ringing or in progress.
                </p>
              </div>
              <PortalBadge className="tabular-nums">{liveQueueCalls.length}</PortalBadge>
            </div>

            {liveQueueCalls.length ? (
              <ul className="space-y-3">
                {liveQueueCalls.map((call) => {
                  const transferOffer = isCanonicalTransferOffer(call, session);
                  const match = session
                    ? selectCanonicalBrowserMediaLeg(
                        call,
                        session.id,
                        session.endpointId,
                        mediaObservations,
                      )
                    : null;
                  const activeReservation =
                    !transferOffer &&
                    (call.answerReservation?.status === "ACCEPTED" ||
                      call.answerReservation?.status === "ANSWERED")
                      ? call.answerReservation
                      : null;
                  const reservedForSession = Boolean(
                    activeReservation &&
                    match &&
                    activeReservation.agentSessionId === session?.id &&
                    activeReservation.legId === match.leg.id,
                  );
                  const answering =
                    reservedForSession ||
                    match?.observation.mediaLegId === runtime.answeringMediaLegId;
                  const rawPhone = callPhone(call);
                  const phone = formatPhone(rawPhone);
                  const ownership = selectLiveCallOwnership(call);
                  if (!ownership) return null;
                  const sharedStatus =
                    transferOffer && match
                      ? "Transfer ringing"
                      : `${
                          ownership.state === "ANSWERED"
                            ? "Answered"
                            : ownership.state === "ANSWERING"
                              ? "Answering"
                              : "Ringing"
                        }${ownership.endpointLabel ? ` · ${ownership.endpointLabel}` : ""}`;
                  const actionableOffer =
                    Boolean(match) && (call.status !== "CONNECTED" || transferOffer);

                  return (
                    <li
                      className="flex flex-col gap-3 border-b border-[var(--portal-border)] py-3 first:mt-2 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                      key={call.id}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--portal-ink)]">
                          {phone}
                        </p>
                        <p className="mt-1 text-xs text-[var(--portal-muted)]">
                          {call.direction === "OUTBOUND" ? "Outbound" : "Inbound"}
                        </p>
                        <p className="mt-1 text-xs text-[var(--portal-muted)]">
                          {sharedStatus}
                        </p>
                        {call.callOfficeLabel ? (
                          <p className="mt-1 text-xs text-[var(--portal-muted)]">
                            <span className="font-medium">Call Office</span>
                            {" · "}
                            <span>{call.callOfficeLabel}</span>
                          </p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          aria-label={`Copy ${
                            call.direction === "OUTBOUND" ? "recipient" : "caller"
                          } phone number`}
                          onClick={() => {
                            void copyPhone(call.id, rawPhone);
                          }}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          {copiedCallId === call.id ? (
                            <Check aria-hidden="true" className="h-4 w-4" />
                          ) : (
                            <Copy aria-hidden="true" className="h-4 w-4" />
                          )}
                          Copy
                        </Button>
                        {actionableOffer ? (
                          <>
                            <Button
                              disabled={!session || Boolean(activeCall)}
                              onClick={() => declineCall(call)}
                              size="sm"
                              variant="secondary"
                            >
                              Decline
                            </Button>
                            {session && match ? (
                              <CanonicalOfferAnswerButton
                                answer={runtime.answer}
                                answering={answering}
                                callId={call.id}
                                connectionState={runtime.media.connection}
                                disabled={
                                  Boolean(activeReservation) ||
                                  Boolean(runtime.answeringMediaLegId) ||
                                  Boolean(activeCall)
                                }
                                legId={match.leg.id}
                                mediaLegId={match.observation.mediaLegId}
                                sessionId={session.id}
                                transferOffer={transferOffer}
                              />
                            ) : null}
                          </>
                        ) : null}
                      </div>
                      {copiedCallId === call.id ? (
                        <span className="sr-only" role="status">
                          Phone number copied
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-[var(--portal-border-strong)] px-3 py-4 text-center text-sm text-[var(--portal-muted)]">
                No callers waiting.
                {callingReady ? " You're ready for calls." : null}
              </div>
            )}
          </section>

          <FollowUpPreview
            followUpHref={followUpHref}
            locationId={office}
            onCallback={(number) => {
              setDestination(number);
              document
                .getElementById("softphone")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            queueId={queueId}
          />

          <nav aria-label="Call Center workspaces">
            <Link
              className="block rounded-xl border border-[var(--portal-border)] bg-white p-4 text-sm font-semibold text-[var(--portal-accent)] shadow-sm hover:bg-[var(--portal-panel-soft)]"
              href={historyHref}
              prefetch={false}
            >
              History
              <span className="mt-1 block text-xs font-normal text-[var(--portal-muted)]">
                Review completed and past calls.
              </span>
            </Link>
          </nav>
        </div>

        <div className="scroll-mt-4 space-y-3" id="softphone">
          <section className="rounded-xl border border-[var(--portal-border)] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--portal-ink)]">
                  Calling
                </h2>
                {agentProfileLabel ? (
                  <p className="mt-1 text-xs text-[var(--portal-muted)]">
                    {agentProfileLabel}
                  </p>
                ) : null}
              </div>
              <CallConnectionStatus connectionState={runtime.media.connection} />
            </div>
          </section>

          {eligibleOutboundNumbers.length > 1 ? (
            <section className="rounded-xl border border-[var(--portal-border)] bg-white p-4 shadow-sm">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-[var(--portal-ink)]">
                Outbound number
                <PortalSelect
                  disabled={
                    !eligibleOutboundNumbers.length ||
                    Boolean(activeCall) ||
                    Boolean(localOffer)
                  }
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

            <AvailabilityControl
              error={runtime.availabilityError}
              occupied={availabilityOccupied}
              onChange={runtime.setAvailability}
              onRetry={
                runtime.availabilityRetryable
                  ? () => void runtime.retryAvailability().catch(() => {})
                  : null
              }
              pending={runtime.availabilityPending}
              presence={session?.presence ?? "OFFLINE"}
              recoveryMessage={availabilityRecovery}
            />

            <div className="space-y-4 p-4">
              {activeCall ? (
                <CanonicalActiveCall
                  call={activeCall}
                  clientInstanceId={clientInstanceId}
                  endpointId={session?.endpointId ?? ""}
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
  clientInstanceId,
  endpointId,
  media,
  sessionId,
}: {
  call: CallView;
  clientInstanceId: string;
  endpointId: string;
  media: Omit<ReturnType<typeof useSoftphoneMedia>, "setRemoteAudioElement">;
  sessionId: string | null;
}) {
  const [callDuration, setCallDuration] = useState(0);
  const [controlError, setControlError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [holdPending, setHoldPending] = useState(false);
  const [localHoldState, setLocalHoldState] = useState<{
    callId: string;
    connectionId: string;
    held: boolean;
    mediaLegId: string;
  } | null>(null);
  const [previousMediaConnection, setPreviousMediaConnection] = useState(
    media.connection,
  );
  const [isMuted, setMuted] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTargets, setTransferTargets] = useState<
    Array<{ endpointId: string; label: string }>
  >([]);
  const [targetEndpointId, setTargetEndpointId] = useState("");
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferTargetLegId, setTransferTargetLegId] = useState<string | null>(null);
  const holdOperationRef = useRef<string | null>(null);
  const transferOperationRef = useRef<{ key: string; targetEndpointId: string } | null>(
    null,
  );
  const outboundAnsweringRef = useRef<string | null>(null);

  // Optimistic hold state belongs to one uninterrupted provider connection.
  // Reset it before rendering a disconnected state so recovery cannot repaint it.
  if (previousMediaConnection !== media.connection) {
    setPreviousMediaConnection(media.connection);
    if (media.connection !== "READY") {
      setHoldPending(false);
      setLocalHoldState(null);
    }
  }

  const transferInProgress = transferring || hasCanonicalPendingTransfer(call);
  const match = sessionId
    ? selectCanonicalBrowserMediaLeg(call, sessionId, endpointId, media.observations)
    : null;
  const canEnd = Boolean(match);
  const phone = formatPhone(callPhone(call));
  const connected = call.status === "CONNECTED";
  const mediaLegId = match?.observation.mediaLegId ?? null;
  const mediaConnectionId = match?.observation.connectionId ?? null;
  const controlsEnabled = Boolean(
    mediaLegId &&
    (match?.leg.status === "BRIDGED" ||
      ["ACTIVE", "HELD"].includes(match?.observation.state ?? "")),
  );
  const observedHeld = match?.observation.state === "HELD";
  // Keep the user's confirmed intent stable across transient updates from this
  // media leg, but never carry it onto a recovered WebRTC connection.
  const localHoldStateMatches = Boolean(
    media.connection === "READY" &&
    localHoldState &&
    localHoldState.callId === call.id &&
    localHoldState.connectionId === mediaConnectionId &&
    localHoldState.mediaLegId === mediaLegId,
  );
  const isHeld =
    localHoldStateMatches && localHoldState ? localHoldState.held : observedHeld;

  useEffect(() => {
    if (call.direction !== "OUTBOUND" || connected || !mediaLegId) {
      return;
    }
    if (match?.observation.state !== "RINGING") {
      outboundAnsweringRef.current = null;
      return;
    }
    if (outboundAnsweringRef.current === mediaLegId) return;
    outboundAnsweringRef.current = mediaLegId;
    void media.answer(mediaLegId).catch((error) => {
      setControlError(errorMessage(error, "answer"));
    });
  }, [call.direction, connected, match?.observation.state, media, mediaLegId]);

  const rememberHoldState = (held: boolean, operationId: string) => {
    if (holdOperationRef.current !== operationId || !mediaConnectionId || !mediaLegId) {
      return;
    }
    setLocalHoldState({
      callId: call.id,
      connectionId: mediaConnectionId,
      held,
      mediaLegId,
    });
  };

  useEffect(() => {
    if (media.connection !== "READY") {
      holdOperationRef.current = null;
    }
  }, [media.connection]);

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

  const sendDtmf = (digit: string) => {
    if (!mediaLegId) return;

    try {
      media.dtmf(mediaLegId, digit);
      setControlError(null);
    } catch (error) {
      showControlError(error, "dtmf");
    }
  };

  const requestHoldMusic = async (action: "START" | "STOP") => {
    const response = await fetch(
      `/api/portal/call-center/calls/${encodeURIComponent(call.id)}/hold-music`,
      {
        body: JSON.stringify({
          action,
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `hold-music:${call.id}:${action}:${crypto.randomUUID()}`,
        },
        method: "POST",
      },
    );
    await callCenterResponse(response);
  };

  const resumeFromHold = async (operationId: string) => {
    if (!mediaLegId) return;
    await requestHoldMusic("STOP");
    try {
      await media.hold(mediaLegId, false);
      rememberHoldState(false, operationId);
    } catch (error) {
      try {
        await requestHoldMusic("START");
      } finally {
        rememberHoldState(true, operationId);
      }
      throw error;
    }
  };

  const toggleHold = async () => {
    if (!mediaLegId || holdPending) return;
    const operationId = crypto.randomUUID();
    holdOperationRef.current = operationId;
    const nextHeld = !isHeld;
    if (nextHeld) setKeypadOpen(false);
    setHoldPending(true);
    setControlError(null);

    try {
      if (nextHeld) {
        rememberHoldState(true, operationId);
        try {
          await media.hold(mediaLegId, true);
        } catch (error) {
          rememberHoldState(false, operationId);
          throw error;
        }
        try {
          await requestHoldMusic("START");
        } catch (error) {
          if (holdMusicMayHaveStarted(error)) {
            await requestHoldMusic("STOP");
          }
          try {
            await media.hold(mediaLegId, false);
            rememberHoldState(false, operationId);
          } catch (rollbackError) {
            rememberHoldState(true, operationId);
            throw rollbackError;
          }
          throw error;
        }
      } else {
        await resumeFromHold(operationId);
      }
    } catch (error) {
      showControlError(error, "hold");
    } finally {
      if (holdOperationRef.current === operationId) {
        holdOperationRef.current = null;
        setHoldPending(false);
      }
    }
  };

  const endCall = async () => {
    if (!mediaLegId || ending || transferInProgress) return;

    setEnding(true);
    try {
      media.hangup(mediaLegId);
      setControlError(null);
    } catch (error) {
      showControlError(error, "end");
      setEnding(false);
    }
  };

  const openTransfer = async () => {
    if (loadingTargets || transferInProgress) return;
    if (transferOpen) {
      setTransferOpen(false);
      return;
    }
    setKeypadOpen(false);
    setTransferOpen(true);
    setLoadingTargets(true);
    setControlError(null);
    try {
      const response = await fetch(
        `/api/portal/call-center/calls/${encodeURIComponent(call.id)}/transfer?clientInstanceId=${encodeURIComponent(clientInstanceId)}`,
      );
      const body = await callCenterResponse<{
        targets?: Array<{ endpointId?: unknown; label?: unknown }>;
      }>(response);
      const targets = (body.targets ?? []).filter(
        (target): target is { endpointId: string; label: string } =>
          typeof target.endpointId === "string" && typeof target.label === "string",
      );
      setTransferTargets(targets);
      setTargetEndpointId((current) =>
        targets.some(({ endpointId: id }) => id === current)
          ? current
          : (targets[0]?.endpointId ?? ""),
      );
    } catch (error) {
      showControlError(error, "transfer");
    } finally {
      setLoadingTargets(false);
    }
  };

  const startTransfer = async () => {
    if (!targetEndpointId || transferring) return;
    setTransferring(true);
    setControlError(null);
    const prior = transferOperationRef.current;
    const key =
      prior?.targetEndpointId === targetEndpointId
        ? prior.key
        : `canonical-transfer:${clientInstanceId}:${crypto.randomUUID()}`;
    transferOperationRef.current = { key, targetEndpointId };
    try {
      if (isHeld) {
        const operationId = crypto.randomUUID();
        holdOperationRef.current = operationId;
        setHoldPending(true);
        try {
          await resumeFromHold(operationId);
        } finally {
          if (holdOperationRef.current === operationId) {
            holdOperationRef.current = null;
            setHoldPending(false);
          }
        }
      }
      const response = await fetch(
        `/api/portal/call-center/calls/${encodeURIComponent(call.id)}/transfer`,
        {
          body: JSON.stringify({
            clientInstanceId,
            expectedStateVersion: call.stateVersion,
            targetEndpointId,
          }),
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          method: "POST",
        },
      );
      const body = await callCenterResponse<{ targetLegId?: unknown }>(response);
      if (typeof body.targetLegId !== "string") {
        throw localCallCenterError("TEMPORARY_SERVICE_FAILURE");
      }
      setTransferTargetLegId(body.targetLegId);
    } catch (error) {
      showControlError(error, "transfer");
      if (
        error instanceof CallCenterRequestError &&
        Boolean(error.operatorError.referenceId)
      ) {
        transferOperationRef.current = null;
      }
      setTransferring(false);
    }
  };

  useEffect(() => {
    if (!transferTargetLegId) return;
    const target = call.legs.find(({ id }) => id === transferTargetLegId);
    if (!target) return;
    if (["ENDED", "FAILED"].includes(target.status)) {
      const timeout = window.setTimeout(() => {
        setControlError("The staff member did not answer. You still have the caller.");
        setTransferring(false);
        setTransferTargetLegId(null);
        transferOperationRef.current = null;
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [call.legs, transferTargetLegId]);

  if (connected) {
    return (
      <div className="@container/active-call rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] p-4">
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

        <div className="mt-4 grid grid-cols-2 gap-2 @min-[30rem]/active-call:grid-cols-5">
          <Button
            aria-pressed={isMuted}
            className="min-w-0 w-full @min-[30rem]/active-call:px-2"
            disabled={!controlsEnabled || ending || holdPending}
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
            className="min-w-0 w-full @min-[30rem]/active-call:px-2"
            disabled={!controlsEnabled || ending || holdPending || transferInProgress}
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
            aria-controls="active-call-keypad"
            aria-expanded={keypadOpen}
            aria-pressed={keypadOpen}
            className="min-w-0 w-full @min-[30rem]/active-call:px-2"
            disabled={
              !controlsEnabled || isHeld || ending || holdPending || transferInProgress
            }
            onClick={() => {
              setTransferOpen(false);
              setKeypadOpen((open) => !open);
            }}
            variant={keypadOpen ? "default" : "secondary"}
          >
            <Grip className="h-4 w-4" aria-hidden="true" />
            Keypad
          </Button>
          <Button
            className="min-w-0 w-full @min-[30rem]/active-call:px-2"
            disabled={!controlsEnabled || ending || holdPending || transferInProgress}
            onClick={() => void openTransfer()}
            variant="secondary"
          >
            <PhoneForwarded className="h-4 w-4" aria-hidden="true" />
            Transfer
          </Button>
          <Button
            className="col-span-2 min-w-0 w-full @min-[30rem]/active-call:col-span-1 @min-[30rem]/active-call:px-2"
            disabled={!controlsEnabled || ending || transferInProgress}
            onClick={() => void endCall()}
            variant="secondary"
          >
            <PhoneOff className="h-4 w-4" aria-hidden="true" />
            {ending ? "Ending" : "End"}
          </Button>
        </div>

        {keypadOpen ? (
          <div
            aria-label="Call keypad"
            className="mt-3 border-t border-[var(--portal-border)] pt-3"
            id="active-call-keypad"
            role="group"
          >
            <div className="mx-auto grid max-w-60 grid-cols-3 gap-2">
              {keypadDigits.map((digit) => (
                <Button
                  aria-label={`Send ${digit}`}
                  className="font-mono text-base"
                  disabled={
                    !controlsEnabled ||
                    isHeld ||
                    ending ||
                    holdPending ||
                    transferInProgress
                  }
                  key={digit}
                  onClick={() => sendDtmf(digit)}
                  variant="secondary"
                >
                  {digit}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {transferOpen ? (
          <div className="mt-3 space-y-2 border-t border-[var(--portal-border)] pt-3">
            {loadingTargets ? (
              <p className="text-xs text-[var(--portal-muted)]">
                Finding available staff…
              </p>
            ) : transferTargets.length ? (
              <>
                <PortalSelect
                  aria-label="Transfer to"
                  disabled={transferring}
                  onChange={(event) => {
                    setTargetEndpointId(event.target.value);
                    transferOperationRef.current = null;
                  }}
                  value={targetEndpointId}
                >
                  {transferTargets.map((target) => (
                    <option key={target.endpointId} value={target.endpointId}>
                      {target.label}
                    </option>
                  ))}
                </PortalSelect>
                <Button
                  className="w-full"
                  disabled={!targetEndpointId || transferring}
                  onClick={() => void startTransfer()}
                  variant="primary"
                >
                  {transferring ? "Ringing staff…" : "Transfer call"}
                </Button>
                <p className="text-xs text-[var(--portal-muted)]">
                  You stay connected until they answer.
                </p>
              </>
            ) : (
              <p className="text-xs text-[var(--portal-muted)]">
                No staff at this location are available.
              </p>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--portal-border)] bg-[var(--portal-panel-soft)] p-4">
      {controlError ? (
        <p className="mb-3 text-sm text-[var(--portal-danger)]" role="alert">
          {controlError}
        </p>
      ) : null}
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

function callPhone(call: CallView) {
  return call.direction === "OUTBOUND" ? call.toPhone : call.fromPhone;
}

export function OperatorStateWarning({
  failedAt,
  observedAt,
  retry,
}: {
  failedAt: string;
  observedAt: string;
  retry: () => void;
}) {
  const [now, setNow] = useState(() => Date.parse(failedAt));
  const observedTime = Date.parse(observedAt);
  const ageSeconds =
    Number.isFinite(observedTime) && Number.isFinite(now)
      ? Math.max(0, Math.floor((now - observedTime) / 1_000))
      : null;
  const age =
    ageSeconds === null
      ? "at an unknown time"
      : ageSeconds < 60
        ? `${ageSeconds}s ago`
        : `${Math.floor(ageSeconds / 60)}m ago`;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div>
        <p className="font-medium">Call activity delayed — retrying</p>
        <p className="mt-1 text-xs">Last updated {age}. Retained calls may be stale.</p>
      </div>
      <Button onClick={retry} size="sm" variant="secondary">
        Retry
      </Button>
    </section>
  );
}

function CanonicalUnavailable({
  connectionState,
  message,
  retry,
}: {
  connectionState: MediaConnectionState;
  message: string;
  retry?: () => void;
}) {
  return (
    <Card className="items-center gap-3 rounded-2xl bg-white px-6 py-10 text-center shadow-sm ring-[var(--portal-border)]">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--portal-panel-soft)] text-[var(--portal-accent)]">
        <Headphones className="h-5 w-5" aria-hidden="true" />
      </div>
      <CallConnectionStatus connectionState={connectionState} />
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
