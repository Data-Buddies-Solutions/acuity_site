import { describe, expect, it } from "bun:test";

import type { CallView, OperationView } from "@/lib/call-center/realtime-contract";

import {
  beginCanonicalTransfer,
  beginCanonicalTake,
  canonicalClaimIdempotencyKey,
  canonicalTransferIdempotencyKey,
  canonicalOutboundIdempotencyKey,
  completeCanonicalOutboundOperation,
  operationShouldAnswerMedia,
  selectCanonicalBrowserMediaLeg,
  selectCanonicalTransferSource,
  selectCanonicalTransferTakeCandidate,
  selectLatestClaimOperation,
  selectLatestTransferOperation,
} from "./canonical-active-call-center";

const call: CallView = {
  answeredAt: null,
  callerName: null,
  direction: "INBOUND",
  endedAt: null,
  fromPhone: "+17865550100",
  id: "call-1",
  legs: [
    {
      agentSessionId: "session-1",
      endpointId: "endpoint-1",
      id: "leg-1",
      kind: "AGENT",
      providerCallControlId: "control-1",
      providerCallLegId: "provider-leg-1",
      providerCallSessionId: "provider-session-1",
      status: "RINGING",
    },
  ],
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

const transferredCall: CallView = {
  ...call,
  legs: [
    {
      agentSessionId: "source-session",
      endpointId: "source-endpoint",
      id: "source-leg",
      kind: "AGENT",
      providerCallControlId: "source-control",
      providerCallLegId: "source-provider-leg",
      providerCallSessionId: "source-provider-session",
      status: "BRIDGED",
    },
    {
      agentSessionId: "target-session",
      endpointId: "target-endpoint",
      id: "target-leg",
      kind: "AGENT",
      providerCallControlId: "target-control",
      providerCallLegId: "target-provider-leg",
      providerCallSessionId: "target-provider-session",
      status: "RINGING",
    },
  ],
  stateVersion: 4,
  status: "CONNECTED",
  winningLegId: "source-leg",
};

const transferOperation: OperationView = {
  callId: transferredCall.id,
  errorCode: null,
  operationEventRevision: "20",
  providerCommandId: "transfer-command",
  sourceLegId: "source-leg",
  status: "SENT",
  targetAgentSessionId: "target-session",
  targetEndpointId: "target-endpoint",
  targetLegId: "target-leg",
  targetUserId: "target-user",
  type: "TRANSFER",
};

const targetObservation = {
  ...observation,
  mediaLegId: "target-media",
  providerCallControlId: "target-control",
  providerCallLegId: "target-provider-leg",
  providerCallSessionId: "target-provider-session",
};

describe("canonical active call center correlation", () => {
  it("reuses one outbound operation key across retries and remounts", () => {
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
    const replay = canonicalOutboundIdempotencyKey(storage, target, () => "two");
    expect(replay).toBe(first);

    const changed = canonicalOutboundIdempotencyKey(
      storage,
      { ...target, destination: "+17865550101" },
      () => "three",
    );
    expect(changed).not.toBe(first);
    completeCanonicalOutboundOperation(
      storage,
      { ...target, destination: "+17865550101" },
      changed,
    );
    expect(canonicalOutboundIdempotencyKey(storage, target, () => "four")).not.toBe(
      first,
    );
  });

  it("uses one stable claim key across retries and remounts", () => {
    expect(canonicalClaimIdempotencyKey("call-1", "session-1")).toBe(
      "canonical-claim:call-1:session-1",
    );
  });

  it("uses one stable transfer key across source retries and remounts", () => {
    const first = canonicalTransferIdempotencyKey(
      "call-1",
      "source-leg",
      "target-endpoint",
    );
    expect(
      canonicalTransferIdempotencyKey("call-1", "source-leg", "target-endpoint"),
    ).toBe(first);
    expect(first).toBe("canonical-transfer:call-1:source-leg:target-endpoint");
  });

  it("deduplicates concurrent Take attempts until the first finishes", () => {
    const inFlight = new Set<string>();
    expect(beginCanonicalTake(inFlight, "call-1")).toBe(true);
    expect(beginCanonicalTake(inFlight, "call-1")).toBe(false);
    inFlight.delete("call-1");
    expect(beginCanonicalTake(inFlight, "call-1")).toBe(true);
  });

  it("blocks concurrent targets for the same source leg", () => {
    const inFlight = new Set<string>();
    expect(beginCanonicalTransfer(inFlight, "call-1", "source-leg")).toBe(true);
    expect(beginCanonicalTransfer(inFlight, "call-1", "source-leg")).toBe(false);
    expect(beginCanonicalTransfer(inFlight, "call-1", "other-source-leg")).toBe(true);
  });

  it("prefers exact provider IDs over provider-session fallback", () => {
    const peer = {
      ...observation,
      mediaLegId: "peer-media",
      providerCallControlId: "peer-control",
      providerCallLegId: "peer-leg",
    };
    expect(
      selectCanonicalBrowserMediaLeg(call, "session-1", "endpoint-1", [
        peer,
        observation,
      ]),
    ).toEqual({ leg: call.legs[0], observation });
  });

  it("matches the single live inbound peer leg from the provider session", () => {
    const peer = {
      ...observation,
      mediaLegId: "peer-media",
      providerCallControlId: "peer-control",
      providerCallLegId: "peer-leg",
    };

    expect(
      selectCanonicalBrowserMediaLeg(call, "session-1", "endpoint-1", [peer]),
    ).toEqual({ leg: call.legs[0], observation: peer });
    expect(
      selectCanonicalBrowserMediaLeg(call, "session-1", "endpoint-1", [
        { ...peer, direction: "OUTBOUND" },
      ]),
    ).toBeNull();
    expect(
      selectCanonicalBrowserMediaLeg(call, "session-1", "endpoint-1", [
        { ...peer, providerCallSessionId: "other-session" },
      ]),
    ).toBeNull();
  });

  it("ignores terminal media and fails closed on live ambiguity", () => {
    const peer = {
      ...observation,
      mediaLegId: "peer-media",
      providerCallControlId: "peer-control",
      providerCallLegId: "peer-leg",
    };

    expect(
      selectCanonicalBrowserMediaLeg(call, "session-1", "endpoint-1", [
        { ...peer, state: "ENDED" },
        observation,
      ]),
    ).toEqual({ leg: call.legs[0], observation });
    expect(
      selectCanonicalBrowserMediaLeg(call, "session-1", "endpoint-1", [
        peer,
        { ...peer, mediaLegId: "peer-media-2" },
      ]),
    ).toBeNull();
  });

  it("converges on the latest durable operation revision", () => {
    const operations: OperationView[] = [
      {
        callId: "call-1",
        errorCode: null,
        operationEventRevision: "10",
        providerCommandId: "command-1",
        status: "PENDING",
        targetAgentSessionId: "session-1",
        targetEndpointId: "endpoint-1",
        targetLegId: "leg-1",
        type: "CLAIM",
      },
      {
        callId: "call-1",
        errorCode: null,
        operationEventRevision: "12",
        providerCommandId: "command-1",
        status: "SENT",
        targetAgentSessionId: "session-1",
        targetEndpointId: "endpoint-1",
        targetLegId: "leg-1",
        type: "CLAIM",
      },
    ];
    const latest = selectLatestClaimOperation(operations, {
      agentSessionId: "session-1",
      callId: "call-1",
      endpointId: "endpoint-1",
      legId: "leg-1",
    });
    expect(latest?.status).toBe("SENT");
    expect(operationShouldAnswerMedia(latest)).toBe(true);
    expect(
      operationShouldAnswerMedia({
        ...operations[1]!,
        errorCode: "PROVIDER_VALIDATION_FAILED",
        status: "FAILED",
      }),
    ).toBe(false);
    expect(
      selectLatestClaimOperation(operations, {
        agentSessionId: "session-2",
        callId: "call-1",
        endpointId: "endpoint-2",
        legId: "leg-2",
      }),
    ).toBeNull();
  });

  it("allows transfer only from the exact current winning source session", () => {
    expect(
      selectCanonicalTransferSource(transferredCall, {
        endpointId: "source-endpoint",
        id: "source-session",
      }),
    ).toEqual(transferredCall.legs[0]);
    expect(
      selectCanonicalTransferSource(transferredCall, {
        endpointId: "target-endpoint",
        id: "target-session",
      }),
    ).toBeNull();
  });

  it("offers target Take only for the exact transfer operation and media leg", () => {
    const candidate = selectCanonicalTransferTakeCandidate(
      [transferredCall],
      [transferOperation],
      { endpointId: "target-endpoint", id: "target-session" },
      [targetObservation],
    );
    expect(candidate).toMatchObject({
      call: { id: "call-1" },
      leg: { id: "target-leg" },
      observation: { mediaLegId: "target-media" },
      operation: { type: "TRANSFER" },
    });
    expect(
      selectCanonicalTransferTakeCandidate(
        [transferredCall],
        [transferOperation],
        { endpointId: "wrong-endpoint", id: "wrong-session" },
        [targetObservation],
      ),
    ).toBeNull();
    expect(
      selectLatestClaimOperation([transferOperation], {
        agentSessionId: "target-session",
        callId: "call-1",
        endpointId: "target-endpoint",
        legId: "target-leg",
      }),
    ).toBeNull();
  });

  it("converges repeated source retries to one target Take candidate", () => {
    const replay: OperationView = {
      ...transferOperation,
      operationEventRevision: "21",
      status: "CONFIRMED",
    };
    expect(
      selectCanonicalTransferTakeCandidate(
        [transferredCall],
        [transferOperation, replay],
        { endpointId: "target-endpoint", id: "target-session" },
        [targetObservation],
      )?.operation,
    ).toEqual(replay);
    expect(
      selectCanonicalTransferTakeCandidate(
        [transferredCall],
        [{ ...replay, errorCode: "PROVIDER_VALIDATION_FAILED", status: "FAILED" }],
        { endpointId: "target-endpoint", id: "target-session" },
        [targetObservation],
      ),
    ).toBeNull();
  });

  it("fails closed on ambiguous target media and converges after bridge callback", () => {
    expect(
      selectCanonicalTransferTakeCandidate(
        [transferredCall],
        [transferOperation],
        { endpointId: "target-endpoint", id: "target-session" },
        [targetObservation, { ...targetObservation, mediaLegId: "other-media" }],
      ),
    ).toBeNull();
    expect(
      selectCanonicalTransferTakeCandidate(
        [{ ...transferredCall, winningLegId: "target-leg" }],
        [transferOperation],
        { endpointId: "target-endpoint", id: "target-session" },
        [targetObservation],
      ),
    ).toBeNull();
  });

  it("shows the latest canonical transfer status for one exact target", () => {
    const failed: OperationView = {
      ...transferOperation,
      errorCode: "PROVIDER_VALIDATION_FAILED",
      operationEventRevision: "22",
      status: "FAILED",
    };
    expect(
      selectLatestTransferOperation([transferOperation, failed], {
        callId: "call-1",
        sourceLegId: "source-leg",
        targetUserId: "target-user",
      }),
    ).toEqual(failed);
    expect(
      selectLatestTransferOperation([transferOperation], {
        callId: "call-1",
        sourceLegId: "source-leg",
        targetUserId: "other-user",
      }),
    ).toBeNull();
  });
});
