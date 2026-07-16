import { describe, expect, it } from "bun:test";

import type { CanonicalTelnyxCallFact } from "../telnyx-canonical-call-fact";
import {
  assertCanonicalCallEffectOwner,
  assertCanonicalProviderLegIdentity,
  canonicalCallObservation,
  confirmProviderCommand,
  confirmExactProviderCommand,
  createStartRecordingAfterGreeting,
  directHandoffLifecycleProjection,
  earliestObservedAt,
  enrichCanonicalCallIdentity,
  hasCanonicalAgentBridgeEvidence,
  isConfirmedAgentConnection,
  processedWinningAgentLegId,
  projectedCallDeadline,
  retainedAgentSessionIds,
  resolveCanonicalAgentLink,
  requireCanonicalProjectionEffectOwner,
  resolveCanonicalPeerAgentLeg,
  selectCanonicalProviderCommand,
  settleProviderCommandCallback,
  shouldPlanCanonicalInboundRouting,
  shouldReconcileCanonicalInboundLifecycle,
  sipEndpointIdentityCandidates,
  terminalSettlementIncludesCustomerLegs,
} from "../prisma-canonical-call-projector";

const later = new Date("2026-07-11T10:00:05.000Z");
const earlier = new Date("2026-07-11T10:00:00.000Z");

describe("canonical agent presence", () => {
  const answeredAgent = {
    eventType: "call.answered",
    legKind: "AGENT",
    legStatus: "ANSWERED",
  };

  it("requires provider confirmation from the owned inbound dial", () => {
    expect(
      isConfirmedAgentConnection({
        ...answeredAgent,
        confirmedCommandType: "DIAL_AGENT",
        direction: "INBOUND",
      }),
    ).toBe(true);
    expect(
      isConfirmedAgentConnection({
        ...answeredAgent,
        confirmedCommandType: null,
        direction: "INBOUND",
      }),
    ).toBe(false);
  });

  it("uses the exact outbound agent callback as confirmation", () => {
    expect(
      isConfirmedAgentConnection({
        ...answeredAgent,
        confirmedCommandType: null,
        direction: "OUTBOUND",
      }),
    ).toBe(true);
  });
});

describe("canonical effect ownership", () => {
  it("requires every projected event to have a durable effect owner", () => {
    expect(requireCanonicalProjectionEffectOwner({ effectOwner: "LEGACY" })).toBe(
      "LEGACY",
    );
    expect(requireCanonicalProjectionEffectOwner({ effectOwner: "CANONICAL" })).toBe(
      "CANONICAL",
    );
    expect(() => requireCanonicalProjectionEffectOwner({ effectOwner: null })).toThrow(
      "CANONICAL_EFFECT_OWNER_MISSING",
    );
  });

  it("rejects an event whose owner contradicts its call", () => {
    expect(() =>
      assertCanonicalCallEffectOwner({ effectOwner: "LEGACY" }, "CANONICAL"),
    ).toThrow("CANONICAL_EFFECT_OWNER_MISMATCH");
    expect(() =>
      assertCanonicalCallEffectOwner({ effectOwner: "CANONICAL" }, "CANONICAL"),
    ).not.toThrow();
  });

  it("plans only canonical inbound customer initiation regardless of queue metadata", () => {
    expect(
      shouldPlanCanonicalInboundRouting({
        direction: "INBOUND",
        effectOwner: "CANONICAL",
        eventType: "call.initiated",
        legKind: "CUSTOMER",
      }),
    ).toBe(true);
    for (const input of [
      {
        direction: "INBOUND" as const,
        effectOwner: "LEGACY" as const,
        eventType: "call.initiated",
        legKind: "CUSTOMER" as const,
      },
      {
        direction: "OUTBOUND" as const,
        effectOwner: "CANONICAL" as const,
        eventType: "call.initiated",
        legKind: "CUSTOMER" as const,
      },
      {
        direction: "INBOUND" as const,
        effectOwner: "CANONICAL" as const,
        eventType: "call.answered",
        legKind: "CUSTOMER" as const,
      },
      {
        direction: "INBOUND" as const,
        effectOwner: "CANONICAL" as const,
        eventType: "call.initiated",
        legKind: "AGENT" as const,
      },
    ]) {
      expect(shouldPlanCanonicalInboundRouting(input)).toBe(false);
    }
  });

  it("reconciles an inbound call from its outbound agent-leg callback", () => {
    expect(
      shouldReconcileCanonicalInboundLifecycle({
        callDirection: "INBOUND",
        effectOwner: "CANONICAL",
        initialRoutingHadNoAgents: false,
        legKind: "AGENT",
      }),
    ).toBe(true);
    expect(
      shouldReconcileCanonicalInboundLifecycle({
        callDirection: "OUTBOUND",
        effectOwner: "CANONICAL",
        initialRoutingHadNoAgents: false,
        legKind: "AGENT",
      }),
    ).toBe(false);
  });
});

describe("direct handoff lifecycle", () => {
  it("marks ingress connected only after the canonical call connects", () => {
    expect(directHandoffLifecycleProjection("RINGING", later)).toBeNull();
    expect(directHandoffLifecycleProjection("CONNECTED", later)).toEqual({
      data: {
        connectedAt: later,
        failedAt: null,
        failureCode: null,
        status: "CONNECTED",
      },
      fromStatus: ["FAILED", "INGRESS_SEEN"],
    });
    expect(directHandoffLifecycleProjection("COMPLETED", later)).toEqual(
      directHandoffLifecycleProjection("CONNECTED", later),
    );
  });

  it("records terminal failure without rewriting a connected handoff", () => {
    expect(directHandoffLifecycleProjection("VOICEMAIL", later)).toEqual({
      data: {
        failedAt: later,
        failureCode: "CALL_VOICEMAIL",
        status: "FAILED",
      },
      fromStatus: ["INGRESS_SEEN"],
    });
  });
});

describe("canonical agent reservation retention", () => {
  const legs = [
    { agentSessionId: "session-1", id: "leg-1", status: "BRIDGED" },
    { agentSessionId: "session-2", id: "leg-2", status: "RINGING" },
    { agentSessionId: "session-3", id: "leg-3", status: "FAILED" },
  ];

  it("keeps every live leg reserved until its terminal provider callback", () => {
    expect([
      ...retainedAgentSessionIds({
        callStatus: "CONNECTED",
        legs,
      }),
    ]).toEqual(["session-1", "session-2"]);
  });

  it("releases ended legs without releasing another live loser", () => {
    expect([
      ...retainedAgentSessionIds({
        callStatus: "CONNECTED",
        legs: legs.map((leg) => (leg.id === "leg-1" ? { ...leg, status: "ENDED" } : leg)),
      }),
    ]).toEqual(["session-2"]);
  });

  it("releases every reservation immediately when the call is terminal", () => {
    expect([...retainedAgentSessionIds({ callStatus: "RINGING", legs })]).toEqual([
      "session-1",
      "session-2",
    ]);
    expect([
      ...retainedAgentSessionIds({
        callStatus: "COMPLETED",
        legs,
      }),
    ]).toEqual([]);
    expect([
      ...retainedAgentSessionIds({
        callStatus: "COMPLETED",
        legs: legs.map((leg) => ({ ...leg, status: "ENDED" })),
      }),
    ]).toEqual([]);
  });
});

describe("canonical bridge winner", () => {
  it("keeps the persisted winner instead of recomputing from timestamps", () => {
    expect(
      processedWinningAgentLegId("leg-first", {
        id: "leg-later",
        kind: "AGENT",
        status: "BRIDGED",
      }),
    ).toBe("leg-first");
  });

  it("elects only the bridged agent leg currently being processed", () => {
    expect(
      processedWinningAgentLegId(null, {
        id: "leg-1",
        kind: "AGENT",
        status: "BRIDGED",
      }),
    ).toBe("leg-1");
    expect(
      processedWinningAgentLegId(null, {
        id: "customer-1",
        kind: "CUSTOMER",
        status: "BRIDGED",
      }),
    ).toBeNull();
  });

  it("replaces the winner only through the target leg's authorized transfer command", () => {
    const target = { id: "target", kind: "AGENT" as const, status: "BRIDGED" };
    const transfer = {
      arguments: { replacesLegId: "source" },
      callId: "call-1",
      id: "transfer-command",
      legId: "target",
      practiceId: "practice-1",
      status: "CONFIRMED" as const,
      type: "DIAL_AGENT" as const,
    };

    expect(processedWinningAgentLegId("source", target, transfer)).toBe("target");
    expect(
      processedWinningAgentLegId("source", target, {
        ...transfer,
        arguments: { replacesLegId: "other-source" },
      }),
    ).toBe("source");
    expect(
      processedWinningAgentLegId("source", target, {
        ...transfer,
        legId: "other-target",
      }),
    ).toBe("source");
  });

  it("does not connect an inbound call when the customer bridge arrives first", () => {
    const call = {
      direction: "INBOUND" as const,
      status: "RINGING" as const,
      winningLegId: null,
    };
    const customerBridge = {
      ...fact({ eventType: "call.bridged", legKind: "CUSTOMER" }),
      callObservation: "CONNECTED" as const,
      legKind: "CUSTOMER" as const,
      legObservation: "BRIDGED" as const,
    };
    expect(canonicalCallObservation(customerBridge, call, "customer-leg")).toBeNull();
    expect(
      hasCanonicalAgentBridgeEvidence(null, [{ id: "customer-leg", kind: "CUSTOMER" }]),
    ).toBe(false);
    expect(
      canonicalCallObservation(
        {
          ...customerBridge,
          callObservation: "RINGING",
          eventType: "call.answered",
          legKind: "AGENT",
          legObservation: "ANSWERED",
        },
        call,
        "agent-leg",
      ),
    ).toBe("RINGING");

    const agentBridge = {
      ...customerBridge,
      canonicalCallId: "call-1",
      canonicalLegId: "agent-leg",
      legKind: "AGENT" as const,
    };
    expect(canonicalCallObservation(agentBridge, call, "agent-leg")).toBe("CONNECTED");
    expect(
      hasCanonicalAgentBridgeEvidence("agent-leg", [
        { id: "customer-leg", kind: "CUSTOMER" },
        { id: "agent-leg", kind: "AGENT" },
      ]),
    ).toBe(true);
  });

  it("drives a direct browser outbound call from answer through hangup", () => {
    const answered = {
      ...fact({ direction: "OUTBOUND", eventType: "call.answered", legKind: "AGENT" }),
      callObservation: "RINGING" as const,
      legKind: "AGENT" as const,
      legObservation: "ANSWERED" as const,
    };
    expect(
      canonicalCallObservation(
        answered,
        {
          direction: "OUTBOUND",
          status: "RINGING",
          winningLegId: null,
        },
        "outbound-leg",
      ),
    ).toBe("CONNECTED");
    expect(
      canonicalCallObservation(
        {
          ...answered,
          callObservation: null,
          eventType: "call.hangup",
          legObservation: "ENDED",
        },
        {
          direction: "OUTBOUND",
          status: "CONNECTED",
          winningLegId: "outbound-leg",
        },
        "outbound-leg",
      ),
    ).toBe("COMPLETED");
  });

  it("ignores a failed transfer target and a late old-source hangup", () => {
    const hangup = {
      ...fact({ direction: "OUTBOUND", eventType: "call.hangup", legKind: "AGENT" }),
      callObservation: null,
      legKind: "AGENT" as const,
      legObservation: "ENDED" as const,
    };

    expect(
      canonicalCallObservation(
        hangup,
        {
          direction: "OUTBOUND",
          status: "CONNECTED",
          winningLegId: "source-leg",
        },
        "failed-target-leg",
      ),
    ).toBeNull();
    expect(
      canonicalCallObservation(
        hangup,
        {
          direction: "OUTBOUND",
          status: "CONNECTED",
          winningLegId: "target-leg",
        },
        "source-leg",
      ),
    ).toBeNull();
  });

  it("completes a connected call only when its current winner hangs up", () => {
    const hangup = {
      ...fact({ direction: "INBOUND", eventType: "call.hangup", legKind: "AGENT" }),
      callObservation: null,
      legKind: "AGENT" as const,
      legObservation: "ENDED" as const,
    };
    expect(
      canonicalCallObservation(
        hangup,
        {
          direction: "INBOUND",
          status: "CONNECTED",
          winningLegId: "winner",
        },
        "winner",
      ),
    ).toBe("COMPLETED");
  });

  it("settles customer media for closed calls but not active voicemail recording", () => {
    expect(terminalSettlementIncludesCustomerLegs("COMPLETED")).toBe(true);
    expect(terminalSettlementIncludesCustomerLegs("ABANDONED")).toBe(true);
    expect(terminalSettlementIncludesCustomerLegs("FAILED")).toBe(true);
    expect(terminalSettlementIncludesCustomerLegs("VOICEMAIL")).toBe(false);
  });

  it("keeps a bounded outbound ring deadline until answer or hangup", () => {
    const deadlineAt = new Date("2026-07-12T20:01:00.000Z");
    const occurredAt = new Date("2026-07-12T20:00:00.000Z");
    expect(
      projectedCallDeadline(
        { deadlineAt, direction: "OUTBOUND" },
        { eventType: "call.initiated", occurredAt },
      ),
    ).toEqual(deadlineAt);
    expect(
      projectedCallDeadline(
        { deadlineAt, direction: "OUTBOUND" },
        { eventType: "call.answered", occurredAt: deadlineAt },
      ),
    ).toBeNull();
    expect(
      projectedCallDeadline(
        { deadlineAt, direction: "OUTBOUND" },
        { eventType: "call.hangup", occurredAt: deadlineAt },
      ),
    ).toBeNull();
  });

  it("expires recording errors immediately and clears successful voicemail deadlines", () => {
    const deadlineAt = new Date("2026-07-12T20:01:00.000Z");
    const occurredAt = new Date("2026-07-12T20:00:30.000Z");
    expect(
      projectedCallDeadline(
        { deadlineAt, direction: "INBOUND" },
        { eventType: "call.recording.error", occurredAt },
      ),
    ).toEqual(occurredAt);
    expect(
      projectedCallDeadline(
        { deadlineAt, direction: "INBOUND" },
        { eventType: "call.recording.saved", occurredAt },
      ),
    ).toBeNull();
  });
});

function fact(overrides: Partial<CanonicalTelnyxCallFact> = {}): CanonicalTelnyxCallFact {
  return {
    callerName: "Patient Name",
    canonicalCallId: null,
    canonicalLegId: null,
    clientQueueItemId: null,
    clientRingAttemptId: null,
    direction: "INBOUND",
    endpointId: null,
    eventType: "call.initiated",
    fromPhone: "+17865550100",
    hangupCauseCode: null,
    legKind: "CUSTOMER",
    occurredAt: earlier,
    providerCallControlId: "control-1",
    providerCommandId: null,
    providerCommandIdSource: null,
    providerCallLegId: "leg-1",
    providerCallSessionId: "session-1",
    providerEventId: "event-1",
    recordingDurationSec: 0,
    recordingId: null,
    recordingUrl: null,
    toAddress: "+17864657479",
    toPhone: "+17864657479",
    ...overrides,
  };
}

describe("canonical browser peer legs", () => {
  it("resolves the provider peer to the one planned endpoint leg", async () => {
    const call = {
      effectOwner: "CANONICAL",
      id: "call-1",
      practiceId: "practice-1",
      queue: { routingMode: "ACTIVE" },
      status: "CONNECTED",
    };
    const plannedLegs = [
      {
        callId: call.id,
        endpointId: "endpoint-winner",
        id: "leg-winner",
        kind: "AGENT",
        startedAt: earlier,
        status: "BRIDGED",
      },
      {
        callId: call.id,
        endpointId: "endpoint-loser",
        id: "leg-loser",
        kind: "AGENT",
        startedAt: earlier,
        status: "RINGING",
      },
    ];
    const tx = {
      callCenterCall: {
        findUnique: async () => call,
      },
      callCenterCallLeg: {
        findFirst: async ({ where }: { where: { endpointId: string } }) =>
          plannedLegs.find(({ endpointId }) => endpointId === where.endpointId) ?? null,
      },
      callCenterEndpoint: {
        findMany: async ({ where }: { where: { sipUsername: { in: string[] } } }) =>
          where.sipUsername.in.includes("loser-seat")
            ? [{ id: "endpoint-loser", practiceId: "practice-1" }]
            : [],
      },
    };

    const peer = await resolveCanonicalPeerAgentLeg(
      tx as never,
      fact({
        direction: null,
        eventType: "call.hangup",
        legKind: null,
        occurredAt: later,
        toAddress: "loser-seat",
        toPhone: "loser-seat",
      }),
    );

    expect(peer?.call).toMatchObject(call);
    expect(peer?.leg).toMatchObject(plannedLegs[1]!);
  });

  it("does not treat ordinary customer ingress as a browser peer", async () => {
    const tx = {
      callCenterEndpoint: {
        findMany: async () => {
          throw new Error("endpoint lookup should not run");
        },
      },
    };

    await expect(resolveCanonicalPeerAgentLeg(tx as never, fact())).resolves.toBeNull();
  });

  it("fails closed when a configured peer has no planned agent leg", async () => {
    const tx = {
      callCenterCall: {
        findUnique: async () => ({
          id: "call-1",
          practiceId: "practice-1",
          queue: { routingMode: "ACTIVE" },
        }),
      },
      callCenterCallLeg: { findFirst: async () => null },
      callCenterEndpoint: {
        findMany: async () => [{ id: "endpoint-1", practiceId: "practice-1" }],
      },
    };

    await expect(
      resolveCanonicalPeerAgentLeg(
        tx as never,
        fact({ toAddress: "sip:seat-1@sip.telnyx.com" }),
      ),
    ).rejects.toThrow("CANONICAL_PEER_AGENT_LEG_NOT_FOUND");
  });

  it("normalizes the supported endpoint SIP forms", () => {
    expect(
      sipEndpointIdentityCandidates("sip:seat-1@sip.telnyx.com;transport=tls"),
    ).toEqual([
      "sip:seat-1@sip.telnyx.com;transport=tls",
      "sip:seat-1@sip.telnyx.com",
      "seat-1@sip.telnyx.com",
      "seat-1",
    ]);
    expect(sipEndpointIdentityCandidates("opaque-browser-credential")).toEqual([
      "opaque-browser-credential",
    ]);
    expect(sipEndpointIdentityCandidates("+19542872010")).toEqual([]);
  });
});

describe("canonical projection enrichment", () => {
  it("moves call and leg start times earlier but never later", () => {
    expect(earliestObservedAt(later, earlier)).toBe(earlier);
    expect(earliestObservedAt(earlier, later)).toBe(earlier);
  });

  it("fills missing customer identity without overwriting richer stored facts", () => {
    const sparse = {
      callerName: "",
      direction: "INBOUND" as const,
      fromPhone: "",
      receivedAt: later,
      toPhone: "",
    };
    expect(enrichCanonicalCallIdentity(sparse, fact(), "CUSTOMER")).toEqual({
      callerName: "Patient Name",
      direction: "INBOUND",
      fromPhone: "+17865550100",
      receivedAt: earlier,
      toPhone: "+17864657479",
    });

    const rich = {
      callerName: "Original Name",
      direction: "INBOUND" as const,
      fromPhone: "+17865550999",
      receivedAt: earlier,
      toPhone: "+17864657000",
    };
    expect(
      enrichCanonicalCallIdentity(rich, fact({ occurredAt: later }), "CUSTOMER"),
    ).toEqual(rich);
  });

  it("never uses agent-leg phone or caller fields to enrich the customer call", () => {
    const call = {
      callerName: null,
      direction: "INBOUND" as const,
      fromPhone: "",
      receivedAt: later,
      toPhone: "",
    };
    expect(
      enrichCanonicalCallIdentity(
        call,
        fact({
          callerName: "SIP Station",
          fromPhone: "+17860000000",
          legKind: null,
          toPhone: "sip:seat@example.test",
        }),
        "AGENT",
      ),
    ).toBe(call);
  });
});

describe("canonical provider linkage", () => {
  const context = {
    callerSession: { telnyxCallSessionId: "customer-session" },
    id: "queue-1",
    practiceId: "practice-1",
  };

  it("requires every supplied provider identity to agree with the matched leg", () => {
    const existing = {
      providerCallControlId: "control-1",
      providerCallLegId: "leg-1",
      providerCallSessionId: "session-1",
    };

    expect(() =>
      assertCanonicalProviderLegIdentity(existing, {
        providerCallControlId: "control-1",
        providerCallLegId: "leg-other",
        providerCallSessionId: "session-1",
      }),
    ).toThrow("CANONICAL_LEG_IDENTITY_MISMATCH");
    expect(() =>
      assertCanonicalProviderLegIdentity(existing, {
        providerCallControlId: "control-other",
        providerCallLegId: "leg-1",
        providerCallSessionId: "session-1",
      }),
    ).toThrow("CANONICAL_LEG_IDENTITY_MISMATCH");
    expect(() =>
      assertCanonicalProviderLegIdentity(existing, {
        providerCallControlId: "control-1",
        providerCallLegId: "leg-1",
        providerCallSessionId: "session-1",
      }),
    ).not.toThrow();
    expect(() =>
      assertCanonicalProviderLegIdentity(
        {
          providerCallControlId: "control-1",
          providerCallLegId: null,
          providerCallSessionId: "session-1",
        },
        {
          providerCallControlId: "control-1",
          providerCallLegId: "leg-1",
          providerCallSessionId: "session-1",
        },
      ),
    ).not.toThrow();
    expect(() =>
      assertCanonicalProviderLegIdentity(existing, {
        providerCallControlId: "control-1",
        providerCallLegId: "leg-1",
        providerCallSessionId: "session-other",
      }),
    ).toThrow("CANONICAL_LEG_IDENTITY_MISMATCH");
  });

  it("never falls back when a supplied ring attempt is missing", () => {
    expect(() =>
      resolveCanonicalAgentLink({
        queueItem: context,
        requestedQueueItemId: context.id,
        requestedRingAttemptId: "attempt-missing",
        ringAttempt: null,
      }),
    ).toThrow("CANONICAL_RING_ATTEMPT_NOT_FOUND");
  });

  it("requires a supplied ring attempt to own the supplied queue item", () => {
    expect(() =>
      resolveCanonicalAgentLink({
        queueItem: null,
        requestedQueueItemId: "queue-other",
        requestedRingAttemptId: "attempt-1",
        ringAttempt: { queueItem: context },
      }),
    ).toThrow("CANONICAL_QUEUE_LINK_MISMATCH");
    expect(
      resolveCanonicalAgentLink({
        queueItem: null,
        requestedQueueItemId: context.id,
        requestedRingAttemptId: "attempt-1",
        ringAttempt: { queueItem: context },
      }),
    ).toBe(context);
  });

  it("uses queue fallback only when ring-attempt identity is omitted", () => {
    expect(
      resolveCanonicalAgentLink({
        queueItem: context,
        requestedQueueItemId: context.id,
        requestedRingAttemptId: null,
        ringAttempt: null,
      }),
    ).toBe(context);
  });
});

describe("canonical provider command correlation", () => {
  const target = { callId: "call-1", legId: "leg-1", practiceId: "practice-1" };
  const command = {
    ...target,
    id: "command-1",
    status: "SENDING" as const,
    type: "DIAL_AGENT" as const,
  };

  it("selects one exact command and keeps confirmed callback replay idempotent", () => {
    expect(selectCanonicalProviderCommand([command], target)).toEqual(command);
    expect(
      selectCanonicalProviderCommand([{ ...command, status: "CONFIRMED" }], target),
    ).toMatchObject({ id: "command-1", status: "CONFIRMED" });
  });

  it("rejects ambiguous or cross-boundary command links", () => {
    expect(() =>
      selectCanonicalProviderCommand([command, { ...command, id: "command-2" }], target),
    ).toThrow("CANONICAL_COMMAND_CORRELATION_AMBIGUOUS");
    expect(() =>
      selectCanonicalProviderCommand([{ ...command, practiceId: "practice-2" }], target),
    ).toThrow("CANONICAL_COMMAND_LINK_MISMATCH");
  });

  it("confirms an explicit in-flight command without exposing provider detail", async () => {
    let update: unknown;
    const tx = {
      callCenterCommand: {
        findMany: async () => [],
        findUnique: async () => command,
        updateMany: async (input: unknown) => {
          update = input;
          return { count: 1 };
        },
      },
      callCenterEvent: {
        create: async () => ({ revision: BigInt(2) }),
        findMany: async () => [],
      },
    };

    await confirmProviderCommand(
      tx as never,
      {
        ...fact({
          canonicalCallId: "call-1",
          canonicalLegId: "leg-1",
          providerCommandId: "command-1",
        }),
        callObservation: "RINGING",
        legKind: "AGENT",
        legObservation: "RINGING",
      },
      target,
    );

    expect(update).toMatchObject({
      data: { errorCode: null, nextAttemptAt: null, status: "CONFIRMED" },
      where: { id: "command-1", status: { in: ["SENDING", "SENT", "FAILED"] } },
    });
  });

  it("uses exact-leg fallback and rejects ambiguous missing command IDs", async () => {
    const tx = {
      callCenterCommand: {
        findMany: async () => [command, { ...command, id: "command-2" }],
        findUnique: async () => null,
        updateMany: async () => ({ count: 0 }),
      },
    };

    await expect(
      confirmProviderCommand(
        tx as never,
        {
          ...fact({ legKind: "AGENT", providerCommandId: null }),
          callObservation: "RINGING",
          legKind: "AGENT",
          legObservation: "RINGING",
        },
        target,
      ),
    ).rejects.toThrow("CANONICAL_COMMAND_CORRELATION_AMBIGUOUS");
  });

  it("authorizes a transfer callback without command_id only from one exact-leg command", async () => {
    const transferCommand = {
      ...command,
      arguments: { replacesLegId: "source-leg" },
    };
    const tx = {
      callCenterCommand: {
        findMany: async () => [transferCommand],
        findUnique: async () => null,
        updateMany: async () => ({ count: 1 }),
      },
      callCenterEvent: {
        create: async () => ({ revision: BigInt(2) }),
        findMany: async () => [],
      },
    };

    await expect(
      confirmProviderCommand(
        tx as never,
        {
          ...fact({ legKind: "AGENT", providerCommandId: null }),
          callObservation: "CONNECTED",
          legKind: "AGENT",
          legObservation: "BRIDGED",
        },
        target,
      ),
    ).resolves.toEqual(transferCommand);
  });

  it("ignores unknown legacy IDs but rejects an unknown canonical command", async () => {
    const tx = {
      callCenterCommand: {
        findMany: async () => [],
        findUnique: async () => null,
        updateMany: async () => ({ count: 0 }),
      },
    };
    const resolved = {
      ...fact({ legKind: "AGENT", providerCommandId: "legacy-command" }),
      callObservation: "RINGING" as const,
      legKind: "AGENT" as const,
      legObservation: "RINGING" as const,
    };

    await expect(confirmProviderCommand(tx as never, resolved, target)).resolves.toBe(
      undefined,
    );
    await expect(
      confirmProviderCommand(
        tx as never,
        {
          ...resolved,
          canonicalCallId: "call-1",
          canonicalLegId: "leg-1",
        },
        target,
      ),
    ).rejects.toThrow("CANONICAL_COMMAND_NOT_FOUND");
  });
});

describe("canonical voicemail command callbacks", () => {
  it("confirms the exact greeting and creates one dependent recording command", async () => {
    const greeting = {
      callId: "call-1",
      id: "greeting-1",
      legId: "customer-leg-1",
      practiceId: "practice-1",
      status: "SENT" as const,
      type: "PLAY_VOICEMAIL_GREETING" as const,
    };
    let recordingCreate: Record<string, unknown> | null = null;
    const tx = {
      callCenterCommand: {
        findUnique: async ({ where }: { where: Record<string, unknown> }) =>
          "id" in where ? greeting : null,
        updateMany: async () => ({ count: 1 }),
        upsert: async ({ create }: { create: Record<string, unknown> }) => {
          recordingCreate = create;
          return { id: "recording-command-1" };
        },
      },
    };

    await expect(
      createStartRecordingAfterGreeting(
        tx as never,
        {
          ...fact({
            eventType: "call.speak.ended",
            legKind: "CUSTOMER",
            providerCommandId: "greeting-1",
          }),
          callObservation: null,
          legKind: "CUSTOMER",
          legObservation: "ANSWERED",
        },
        {
          callId: "call-1",
          legId: "customer-leg-1",
          practiceId: "practice-1",
        },
      ),
    ).resolves.toEqual({ created: true, id: "recording-command-1" });
    expect(recordingCreate).toMatchObject({
      arguments: {},
      dependsOnCommandId: "greeting-1",
      idempotencyKey: "voicemail-recording:greeting-1",
      legId: "customer-leg-1",
      type: "START_RECORDING",
    });
  });

  it("rejects a callback linked to the wrong command type", async () => {
    const tx = {
      callCenterCommand: {
        findUnique: async () => ({
          callId: "call-1",
          id: "command-1",
          legId: "customer-leg-1",
          practiceId: "practice-1",
          status: "SENT",
          type: "START_RECORDING",
        }),
      },
    };
    await expect(
      createStartRecordingAfterGreeting(
        tx as never,
        {
          ...fact({ providerCommandId: "command-1" }),
          callObservation: null,
          legKind: "CUSTOMER",
          legObservation: "ANSWERED",
        },
        {
          callId: "call-1",
          legId: "customer-leg-1",
          practiceId: "practice-1",
        },
      ),
    ).rejects.toThrow("CANONICAL_COMMAND_LINK_MISMATCH");
  });

  it("defers an out-of-order recording callback until its command exists", async () => {
    const tx = {
      callCenterCommand: { findUnique: async () => null },
    };
    await expect(
      confirmExactProviderCommand(
        tx as never,
        {
          ...fact({
            eventType: "call.recording.saved",
            legKind: null,
            providerCommandId: "recording-command-missing",
            recordingId: "recording-1",
            recordingUrl: "https://example.test/voicemail.mp3",
          }),
          callObservation: "VOICEMAIL",
          legKind: "CUSTOMER",
          legObservation: "ENDED",
        },
        {
          callId: "call-1",
          expectedType: "START_RECORDING",
          legId: "customer-leg-1",
          practiceId: "practice-1",
        },
      ),
    ).rejects.toThrow("CANONICAL_COMMAND_NOT_FOUND");
  });
});

describe("canonical provider lifecycle callbacks", () => {
  const cases = [
    ["call.answered", "ANSWER_CUSTOMER", "CONFIRMED"],
    ["call.playback.started", "START_RINGBACK", "CONFIRMED"],
    ["call.playback.ended", "STOP_PLAYBACK", "CONFIRMED"],
    ["call.speak.started", "PLAY_VOICEMAIL_GREETING", "CONFIRMED"],
    ["call.recording.error", "START_RECORDING", "FAILED"],
    ["call.hangup", "HANGUP_LEG", "CONFIRMED"],
  ] as const;

  it("settles every exact Telnyx command callback without leaving SENT rows", async () => {
    for (const [eventType, type, outcome] of cases) {
      let update: { data: Record<string, unknown> } | null = null;
      const command = {
        callId: "call-1",
        id: "command-1",
        legId: "customer-leg-1",
        practiceId: "practice-1",
        status: "SENT" as const,
        type,
      };
      const tx = {
        callCenterCommand: {
          findMany: async () => [],
          findUnique: async () => command,
          updateMany: async (input: { data: Record<string, unknown> }) => {
            update = input;
            return { count: 1 };
          },
        },
      };

      await expect(
        settleProviderCommandCallback(
          tx as never,
          {
            ...fact({ eventType, providerCommandId: "command-1" }),
            callObservation: null,
            legKind: "CUSTOMER",
            legObservation: eventType === "call.hangup" ? "ENDED" : "ANSWERED",
          },
          {
            callId: "call-1",
            legId: "customer-leg-1",
            practiceId: "practice-1",
          },
        ),
      ).resolves.toEqual(command);
      expect(update).toMatchObject({
        data: {
          errorCode: outcome === "FAILED" ? "PROVIDER_CALLBACK_FAILED" : null,
          nextAttemptAt: null,
          status: outcome,
        },
      });
    }
  });

  it("does not mistake stale client state on a remote hangup for a hangup command", async () => {
    let updates = 0;
    const tx = {
      callCenterCommand: {
        findUnique: async () => ({
          callId: "call-1",
          id: "ringback-command",
          legId: "customer-leg-1",
          practiceId: "practice-1",
          status: "SENT",
          type: "START_RINGBACK",
        }),
        updateMany: async () => {
          updates += 1;
          return { count: 1 };
        },
      },
    };

    await expect(
      settleProviderCommandCallback(
        tx as never,
        {
          ...fact({ eventType: "call.hangup", providerCommandId: "ringback-command" }),
          callObservation: "HANGUP",
          legKind: "CUSTOMER",
          legObservation: "ENDED",
        },
        {
          callId: "call-1",
          legId: "customer-leg-1",
          practiceId: "practice-1",
        },
      ),
    ).resolves.toBeNull();
    expect(updates).toBe(0);
  });

  it("ignores stale command client state on unrelated provider callbacks", async () => {
    let updates = 0;
    const tx = {
      callCenterCommand: {
        findUnique: async () => ({
          callId: "call-1",
          id: "stop-command",
          legId: "customer-leg-1",
          practiceId: "practice-1",
          status: "SENT",
          type: "STOP_PLAYBACK",
        }),
        updateMany: async () => {
          updates += 1;
          return { count: 1 };
        },
      },
    };

    await expect(
      settleProviderCommandCallback(
        tx as never,
        {
          ...fact({
            eventType: "call.playback.started",
            providerCommandId: "stop-command",
            providerCommandIdSource: "CLIENT_STATE",
          }),
          callObservation: null,
          legKind: "CUSTOMER",
          legObservation: "ANSWERED",
        },
        {
          callId: "call-1",
          legId: "customer-leg-1",
          practiceId: "practice-1",
        },
      ),
    ).resolves.toBeNull();
    expect(updates).toBe(0);
  });

  it("rejects an explicit provider callback linked to the wrong command type", async () => {
    const tx = {
      callCenterCommand: {
        findUnique: async () => ({
          callId: "call-1",
          id: "stop-command",
          legId: "customer-leg-1",
          practiceId: "practice-1",
          status: "SENT",
          type: "STOP_PLAYBACK",
        }),
      },
    };

    await expect(
      settleProviderCommandCallback(
        tx as never,
        {
          ...fact({
            eventType: "call.playback.started",
            providerCommandId: "stop-command",
            providerCommandIdSource: "PAYLOAD",
          }),
          callObservation: null,
          legKind: "CUSTOMER",
          legObservation: "ANSWERED",
        },
        {
          callId: "call-1",
          legId: "customer-leg-1",
          practiceId: "practice-1",
        },
      ),
    ).rejects.toThrow("CANONICAL_COMMAND_LINK_MISMATCH");
  });

  it("accepts one late recording callback after timeout recovery", async () => {
    let status = "FAILED";
    let updates = 0;
    const command = {
      callId: "call-1",
      id: "recording-command-1",
      legId: "customer-leg-1",
      practiceId: "practice-1",
      status,
      type: "START_RECORDING",
    };
    const tx = {
      callCenterCommand: {
        findUnique: async () => ({ ...command, status }),
        updateMany: async () => {
          if (status === "CONFIRMED") return { count: 0 };
          status = "CONFIRMED";
          updates += 1;
          return { count: 1 };
        },
      },
    };
    const callback = {
      ...fact({
        eventType: "call.recording.saved",
        providerCommandId: command.id,
        recordingId: "recording-1",
        recordingUrl: "https://example.test/voicemail.mp3",
      }),
      callObservation: "VOICEMAIL" as const,
      legKind: "CUSTOMER" as const,
      legObservation: "ENDED" as const,
    };
    const input = {
      callId: "call-1",
      legId: "customer-leg-1",
      practiceId: "practice-1",
    };

    await settleProviderCommandCallback(tx as never, callback, input);
    await settleProviderCommandCallback(tx as never, callback, input);

    expect(status).toBe("CONFIRMED");
    expect(updates).toBe(1);
  });
});
