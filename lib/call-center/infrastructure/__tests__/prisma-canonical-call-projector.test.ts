import { describe, expect, it } from "bun:test";

import type { CanonicalTelnyxCallFact } from "../telnyx-canonical-call-fact";
import {
  assertCanonicalProviderLegIdentity,
  canonicalCallObservation,
  confirmProviderCommand,
  confirmExactProviderCommand,
  createStartRecordingAfterGreeting,
  directHandoffLifecycleProjection,
  earliestObservedAt,
  enrichCanonicalCallIdentity,
  hasCanonicalAgentBridgeEvidence,
  pendingDialAgentCommandIdsForCustomerCallback,
  processedWinningAgentLegId,
  projectedCallDeadline,
  resolveCanonicalCustomerCall,
  resolveCanonicalPeerAgentLeg,
  selectCanonicalProviderCommand,
  settleProviderCommandCallback,
  shouldConfirmCanonicalAgentCommand,
  shouldPlanCanonicalInboundRouting,
  shouldReconcileCanonicalInboundLifecycle,
  sipEndpointIdentityCandidates,
  terminalSettlementIncludesCustomerLegs,
} from "../prisma-canonical-call-projector";

const later = new Date("2026-07-11T10:00:05.000Z");
const earlier = new Date("2026-07-11T10:00:00.000Z");

describe("canonical routing triggers", () => {
  it("does not treat an ignored agent media callback as a dial confirmation", () => {
    expect(
      shouldConfirmCanonicalAgentCommand({
        eventType: "call.playback.started",
        legKind: "AGENT",
        mediaCommandCallback: true,
        settledCommand: false,
      }),
    ).toBe(false);
    expect(
      shouldConfirmCanonicalAgentCommand({
        eventType: "call.answered",
        legKind: "AGENT",
        mediaCommandCallback: false,
        settledCommand: false,
      }),
    ).toBe(true);
  });

  it("plans only inbound customer initiation regardless of queue metadata", () => {
    expect(
      shouldPlanCanonicalInboundRouting({
        direction: "INBOUND",
        eventType: "call.initiated",
        legKind: "CUSTOMER",
      }),
    ).toBe(true);
    for (const input of [
      {
        direction: "OUTBOUND" as const,
        eventType: "call.initiated",
        legKind: "CUSTOMER" as const,
      },
      {
        direction: "INBOUND" as const,
        eventType: "call.answered",
        legKind: "CUSTOMER" as const,
      },
      {
        direction: "INBOUND" as const,
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
        eventType: "call.answered",
        initialRoutingHadNoAgents: false,
        legKind: "AGENT",
      }),
    ).toBe(true);
    expect(
      shouldReconcileCanonicalInboundLifecycle({
        callDirection: "OUTBOUND",
        eventType: "call.answered",
        initialRoutingHadNoAgents: false,
        legKind: "AGENT",
      }),
    ).toBe(false);
  });

  it("uses the end of customer ringback as the fixed offer-window trigger", () => {
    expect(
      shouldReconcileCanonicalInboundLifecycle({
        callDirection: "INBOUND",
        eventType: "call.playback.ended",
        initialRoutingHadNoAgents: false,
        legKind: "CUSTOMER",
      }),
    ).toBe(true);
  });

  it("wakes both pending agent dials from answer and ringback callbacks", async () => {
    for (const eventType of ["call.answered", "call.playback.started"]) {
      let query: unknown;
      const tx = {
        callCenterCommand: {
          findMany: async (input: unknown) => {
            query = input;
            return [{ id: "dial-agent-a" }, { id: "dial-agent-b" }];
          },
        },
      };

      await expect(
        pendingDialAgentCommandIdsForCustomerCallback(tx as never, {
          callDirection: "INBOUND",
          callId: "call-1",
          eventType,
          legKind: "CUSTOMER",
          practiceId: "practice-1",
        }),
      ).resolves.toEqual(["dial-agent-a", "dial-agent-b"]);
      expect(query).toEqual({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
        where: {
          callId: "call-1",
          practiceId: "practice-1",
          status: "PENDING",
          type: "DIAL_AGENT",
        },
      });
    }
  });
});

describe("canonical customer call resolution", () => {
  it("locks the practice and rechecks identity before creating a call", async () => {
    const operations: string[] = [];
    const tx = {
      $queryRaw: async () => {
        operations.push("practice.lock");
        return [];
      },
      callCenterCall: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          operations.push("call.create");
          return { ...data, id: "call-1" };
        },
        findUnique: async () => {
          operations.push("call.lookup");
          return null;
        },
      },
      callCenterNumber: {
        findMany: async () => {
          operations.push("number.lookup");
          return [
            {
              id: "number-1",
              inboundQueue: { enabled: true, practiceId: "practice-1" },
              inboundQueueId: "queue-1",
              practiceId: "practice-1",
            },
          ];
        },
      },
    };

    await resolveCanonicalCustomerCall(tx as never, {
      ...fact({ eventType: "call.initiated", legKind: "CUSTOMER" }),
      callObservation: "RINGING",
      direction: "INBOUND",
      legKind: "CUSTOMER",
      legObservation: "RINGING",
      providerCallSessionId: "session-1",
    });

    expect(operations).toEqual([
      "call.lookup",
      "number.lookup",
      "practice.lock",
      "call.lookup",
      "call.create",
    ]);
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

  it("never replaces a persisted winner", () => {
    expect(
      processedWinningAgentLegId("source", {
        id: "target",
        kind: "AGENT",
        status: "BRIDGED",
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

  it("ignores a failed losing leg and a late non-winner hangup", () => {
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
    playbackStatus: null,
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
      id: "call-1",
      practiceId: "practice-1",
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
      data: { errorCode: null, status: "CONFIRMED" },
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

  it("authorizes a callback without command_id only from one exact-leg command", async () => {
    const tx = {
      callCenterCommand: {
        findMany: async () => [command],
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
    ).resolves.toEqual(command);
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
    ["call.playback.started", "START_HOLD_MUSIC", "CONFIRMED"],
    ["call.playback.ended", "STOP_PLAYBACK", "CONFIRMED"],
    ["call.playback.ended", "STOP_HOLD_MUSIC", "CONFIRMED"],
    ["call.speak.started", "PLAY_VOICEMAIL_GREETING", "CONFIRMED"],
    ["call.recording.error", "START_RECORDING", "FAILED"],
    ["call.hangup", "HANGUP_LEG", "CONFIRMED"],
  ] as const;

  it("settles every exact Telnyx command callback without leaving SENT rows", async () => {
    for (const [eventType, type, outcome] of cases) {
      let update: { data: Record<string, unknown> } | null = null;
      const command = {
        callId: "call-1",
        errorCode: null,
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
          status: outcome,
        },
      });
    }
  });

  it("fails a confirmed hold command when playback asynchronously fails", async () => {
    let update: { data: Record<string, unknown>; where: Record<string, unknown> } | null =
      null;
    const command = {
      callId: "call-1",
      errorCode: null,
      id: "command-1",
      legId: "agent-leg-1",
      practiceId: "practice-1",
      status: "CONFIRMED" as const,
      type: "START_HOLD_MUSIC" as const,
    };
    const tx = {
      callCenterCommand: {
        findMany: async () => [],
        findUnique: async () => command,
        updateMany: async (input: {
          data: Record<string, unknown>;
          where: Record<string, unknown>;
        }) => {
          update = input;
          return { count: 1 };
        },
      },
    };

    await settleProviderCommandCallback(
      tx as never,
      {
        ...fact({
          eventType: "call.playback.ended",
          playbackStatus: "failed",
          providerCommandId: "command-1",
        }),
        callObservation: null,
        legKind: "AGENT",
        legObservation: "ANSWERED",
      },
      { callId: "call-1", legId: "agent-leg-1", practiceId: "practice-1" },
    );

    expect(update).toMatchObject({
      data: { errorCode: "PROVIDER_PLAYBACK_FAILED", status: "FAILED" },
      where: { id: "command-1", status: { in: ["SENDING", "SENT", "CONFIRMED"] } },
    });
  });

  it("keeps a confirmed hold command settled when playback ends normally", async () => {
    let update: { data: Record<string, unknown>; where: Record<string, unknown> } | null =
      null;
    const tx = {
      callCenterCommand: {
        findUnique: async () => ({
          callId: "call-1",
          errorCode: null,
          id: "command-1",
          legId: "agent-leg-1",
          practiceId: "practice-1",
          status: "CONFIRMED",
          type: "START_HOLD_MUSIC",
        }),
        updateMany: async (input: {
          data: Record<string, unknown>;
          where: Record<string, unknown>;
        }) => {
          update = input;
          return { count: 0 };
        },
      },
    };

    await expect(
      settleProviderCommandCallback(
        tx as never,
        {
          ...fact({
            eventType: "call.playback.ended",
            playbackStatus: "cancelled",
            providerCommandId: "command-1",
          }),
          callObservation: null,
          legKind: "AGENT",
          legObservation: "ANSWERED",
        },
        { callId: "call-1", legId: "agent-leg-1", practiceId: "practice-1" },
      ),
    ).resolves.toMatchObject({ status: "CONFIRMED" });
    expect(update).toMatchObject({
      data: { errorCode: null, status: "CONFIRMED" },
      where: { id: "command-1", status: { in: ["SENDING", "SENT", "FAILED"] } },
    });
  });

  it("does not fail routing when non-hold playback reports a media failure", async () => {
    let update: { data: Record<string, unknown> } | null = null;
    const command = {
      callId: "call-1",
      errorCode: null,
      id: "command-1",
      legId: "customer-leg-1",
      practiceId: "practice-1",
      status: "SENT" as const,
      type: "START_RINGBACK" as const,
    };
    const tx = {
      callCenterCommand: {
        findUnique: async () => command,
        updateMany: async (input: { data: Record<string, unknown> }) => {
          update = input;
          return { count: 1 };
        },
      },
    };

    await settleProviderCommandCallback(
      tx as never,
      {
        ...fact({
          eventType: "call.playback.ended",
          providerCommandId: "command-1",
        }),
        callObservation: null,
        legKind: "CUSTOMER",
        legObservation: "ANSWERED",
      },
      { callId: "call-1", legId: "customer-leg-1", practiceId: "practice-1" },
    );

    expect(update).toMatchObject({ data: { errorCode: null, status: "CONFIRMED" } });
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
