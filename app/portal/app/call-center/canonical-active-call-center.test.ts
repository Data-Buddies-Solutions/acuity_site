import { describe, expect, it } from "bun:test";

import { CallCenterRequestError } from "@/lib/call-center/operator-error";
import type { CallView } from "@/lib/call-center/realtime-contract";

import {
  canonicalOutboundIdempotencyKey,
  completeCanonicalOutboundOperation,
  failCanonicalOutboundOperation,
  hasCanonicalSessionLiveLeg,
  hasCanonicalPendingTransfer,
  isDefinitiveCanonicalOutboundFailure,
  isCanonicalTransferOffer,
  reconcileCanonicalOutboundRuntime,
  selectCanonicalAgentActiveCall,
  selectCanonicalBrowserMediaLeg,
  selectCanonicalTransferOffers,
} from "./canonical-active-call-center";

const call: CallView = {
  answeredAt: null,
  callOfficeLabel: null,
  callerName: null,
  direction: "INBOUND",
  endedAt: null,
  fromPhone: "+17865550100",
  id: "call-1",
  legs: [
    {
      agentSessionId: "session-1",
      endpointId: "endpoint-1",
      endpointLabel: null,
      id: "leg-1",
      kind: "AGENT",
      providerCallControlId: "control-1",
      providerCallLegId: "provider-leg-1",
      providerCallSessionId: "provider-session-1",
      status: "RINGING",
    },
  ],
  onHold: false,
  transferring: false,
  queueId: "queue-1",
  receivedAt: "2026-07-12T12:00:00.000Z",
  stateVersion: 1,
  status: "RINGING",
  toPhone: "+17865550199",
  winningLegId: null,
};

const observation = {
  connectionId: "connection-1",
  direction: "INBOUND" as const,
  mediaLegId: "media-1",
  providerCallControlId: "control-1",
  providerCallLegId: "provider-leg-1",
  providerCallSessionId: "provider-session-1",
  remoteAudioReady: false,
  state: "RINGING" as const,
};

describe("hasCanonicalSessionLiveLeg", () => {
  it("uses canonical live-leg status semantics for session occupancy", () => {
    expect(hasCanonicalSessionLiveLeg([call], { id: "session-1" })).toBe(true);
    expect(
      hasCanonicalSessionLiveLeg(
        [{ ...call, legs: [{ ...call.legs[0]!, status: "ENDED" }] }],
        { id: "session-1" },
      ),
    ).toBe(false);
  });
});

describe("canonical active call center correlation", () => {
  it("derives occupancy from the winning bridged leg instead of session pointers", () => {
    const connected = {
      ...call,
      answeredAt: "2026-07-12T12:00:10.000Z",
      legs: [{ ...call.legs[0]!, status: "BRIDGED" as const }],
      status: "CONNECTED" as const,
      transferring: false,
      winningLegId: "leg-1",
    };
    expect(
      selectCanonicalAgentActiveCall([call, connected], {
        endpointId: "endpoint-1",
        id: "session-1",
      }),
    ).toEqual(connected);
    expect(
      selectCanonicalAgentActiveCall([connected], {
        endpointId: "endpoint-2",
        id: "session-2",
      }),
    ).toBeNull();
  });

  it("matches one exact live provider leg and fails closed on ambiguity", () => {
    expect(
      selectCanonicalBrowserMediaLeg(call, "session-1", "endpoint-1", [observation]),
    ).toEqual({ leg: call.legs[0], observation });
    expect(
      selectCanonicalBrowserMediaLeg(call, "session-1", "endpoint-1", [
        observation,
        { ...observation, mediaLegId: "media-2" },
      ]),
    ).toBeNull();
  });

  it("shows a connected non-winning leg only to the transfer target", () => {
    const transferred = {
      ...call,
      answeredAt: "2026-07-12T12:00:10.000Z",
      legs: [
        { ...call.legs[0]!, status: "BRIDGED" as const },
        {
          ...call.legs[0]!,
          agentSessionId: "session-2",
          endpointId: "endpoint-2",
          id: "leg-2",
          providerCallControlId: "control-2",
          providerCallLegId: "provider-leg-2",
          status: "RINGING" as const,
        },
      ],
      status: "CONNECTED" as const,
      transferring: true,
      winningLegId: "leg-1",
    };
    const target = { endpointId: "endpoint-2", id: "session-2" };
    const outboundTransferred = { ...transferred, direction: "OUTBOUND" as const };
    const targetActiveCall = selectCanonicalAgentActiveCall(
      [outboundTransferred],
      target,
    );
    expect(isCanonicalTransferOffer(transferred, target)).toBe(true);
    expect(hasCanonicalPendingTransfer(transferred)).toBe(true);
    expect(selectCanonicalTransferOffers([transferred], target)).toEqual([transferred]);
    expect(targetActiveCall).toBeNull();
    expect(
      reconcileCanonicalOutboundRuntime({
        awaitingFreshSnapshot: false,
        canonicalCallId: null,
        canonicalCallObserved: false,
        canonicalCallVisible: false,
        freshSnapshotAvailable: false,
        hasActiveOutboundCall: Boolean(targetActiveCall),
        startingOutbound: false,
      }),
    ).toEqual({ active: false, callId: null, observed: false });
    expect(
      selectCanonicalAgentActiveCall([outboundTransferred], {
        endpointId: "endpoint-1",
        id: "session-1",
      }),
    ).not.toBeNull();
    expect(
      selectCanonicalTransferOffers([transferred], {
        endpointId: "endpoint-1",
        id: "session-1",
      }),
    ).toEqual([]);
  });

  it("fails closed for connected outbound calls without a bridged winner", () => {
    const outbound = {
      ...call,
      answeredAt: "2026-07-12T12:00:10.000Z",
      direction: "OUTBOUND" as const,
      legs: [
        { ...call.legs[0]!, status: "ANSWERED" as const },
        {
          ...call.legs[0]!,
          agentSessionId: "session-2",
          endpointId: "endpoint-2",
          id: "leg-2",
          providerCallControlId: "control-2",
          providerCallLegId: "provider-leg-2",
          status: "RINGING" as const,
        },
      ],
      status: "CONNECTED" as const,
      transferring: true,
      winningLegId: null,
    };
    const source = { endpointId: "endpoint-1", id: "session-1" };
    const target = { endpointId: "endpoint-2", id: "session-2" };

    expect(selectCanonicalAgentActiveCall([outbound], source)).toBeNull();
    expect(selectCanonicalAgentActiveCall([outbound], target)).toBeNull();
    expect(isCanonicalTransferOffer(outbound, source)).toBe(false);
    expect(isCanonicalTransferOffer(outbound, target)).toBe(false);
    expect(hasCanonicalPendingTransfer(outbound)).toBe(false);
  });

  it("does not treat a lone null-winner outbound source as a transfer offer", () => {
    const outbound = {
      ...call,
      answeredAt: "2026-07-12T12:00:10.000Z",
      direction: "OUTBOUND" as const,
      legs: [{ ...call.legs[0]!, status: "ANSWERED" as const }],
      status: "CONNECTED" as const,
      winningLegId: null,
    };
    const source = { endpointId: "endpoint-1", id: "session-1" };

    expect(isCanonicalTransferOffer(outbound, source)).toBe(false);
    expect(hasCanonicalPendingTransfer(outbound)).toBe(false);
  });

  it("does not keep source controls hidden for an orphaned live target leg", () => {
    const failed = {
      ...call,
      answeredAt: "2026-07-12T12:00:10.000Z",
      legs: [
        { ...call.legs[0]!, status: "BRIDGED" as const },
        {
          ...call.legs[0]!,
          agentSessionId: "session-2",
          endpointId: "endpoint-2",
          id: "target-leg",
          status: "RINGING" as const,
        },
      ],
      status: "CONNECTED" as const,
      transferring: false,
      winningLegId: "leg-1",
    };

    expect(hasCanonicalPendingTransfer(failed)).toBe(false);
    expect(hasCanonicalPendingTransfer({ ...failed, transferring: true })).toBe(true);
  });

  it("clears stale suppression after a workspace remount", () => {
    expect(
      reconcileCanonicalOutboundRuntime({
        awaitingFreshSnapshot: false,
        canonicalCallId: null,
        canonicalCallObserved: false,
        canonicalCallVisible: false,
        freshSnapshotAvailable: false,
        hasActiveOutboundCall: false,
        startingOutbound: false,
      }),
    ).toEqual({ active: false, callId: null, observed: false });
  });

  it("preserves suppression while a new call is missing from a stale snapshot", () => {
    expect(
      reconcileCanonicalOutboundRuntime({
        awaitingFreshSnapshot: true,
        canonicalCallId: "outbound-call-1",
        canonicalCallObserved: false,
        canonicalCallVisible: false,
        freshSnapshotAvailable: false,
        hasActiveOutboundCall: false,
        startingOutbound: false,
      }),
    ).toBeNull();
  });

  it("clears suppression when a fresh snapshot misses a fast terminal call", () => {
    expect(
      reconcileCanonicalOutboundRuntime({
        awaitingFreshSnapshot: true,
        canonicalCallId: "outbound-call-1",
        canonicalCallObserved: false,
        canonicalCallVisible: false,
        freshSnapshotAvailable: true,
        hasActiveOutboundCall: false,
        startingOutbound: false,
      }),
    ).toEqual({ active: false, callId: null, observed: false });
  });

  it("keeps ambiguous request failures suppressed until a fresh snapshot", () => {
    const pending = {
      awaitingFreshSnapshot: true,
      canonicalCallId: null,
      canonicalCallObserved: false,
      canonicalCallVisible: false,
      hasActiveOutboundCall: false,
      startingOutbound: false,
    };

    expect(
      reconcileCanonicalOutboundRuntime({
        ...pending,
        freshSnapshotAvailable: false,
      }),
    ).toBeNull();
    expect(
      reconcileCanonicalOutboundRuntime({
        ...pending,
        freshSnapshotAvailable: true,
      }),
    ).toEqual({ active: false, callId: null, observed: false });
  });

  it("reuses one outbound operation key until that operation completes", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const target = {
      clientInstanceId: "browser-1",
      destination: "+17865550100",
      numberId: "number-1",
      queueId: "queue-1",
    };
    const first = canonicalOutboundIdempotencyKey(storage, target, () => "one");
    expect(canonicalOutboundIdempotencyKey(storage, target, () => "two")).toBe(first);
    completeCanonicalOutboundOperation(storage, target, first);
    expect(canonicalOutboundIdempotencyKey(storage, target, () => "three")).not.toBe(
      first,
    );
  });

  it("retires an outbound key only after an explicit terminal rejection", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const target = {
      clientInstanceId: "browser-1",
      destination: "+17865550100",
      numberId: "number-1",
      queueId: "queue-1",
    };
    const first = canonicalOutboundIdempotencyKey(storage, target, () => "one");

    failCanonicalOutboundOperation(storage, target, first, new TypeError("lost"));
    expect(isDefinitiveCanonicalOutboundFailure(new TypeError("lost"))).toBe(false);
    expect(canonicalOutboundIdempotencyKey(storage, target, () => "two")).toBe(first);

    failCanonicalOutboundOperation(
      storage,
      target,
      first,
      new CallCenterRequestError({
        code: "OUTBOUND_CALL_FAILED",
        referenceId: "ABC123",
        retryable: false,
      }),
    );
    expect(
      isDefinitiveCanonicalOutboundFailure(
        new CallCenterRequestError({
          code: "OUTBOUND_CALL_FAILED",
          referenceId: "ABC123",
          retryable: false,
        }),
      ),
    ).toBe(true);
    expect(canonicalOutboundIdempotencyKey(storage, target, () => "three")).not.toBe(
      first,
    );
  });
});
