import { describe, expect, it } from "bun:test";

import type { CanonicalTelnyxCallFact } from "../telnyx-canonical-call-fact";
import {
  assertCanonicalProviderLegIdentity,
  confirmProviderCommand,
  earliestObservedAt,
  enrichCanonicalCallIdentity,
  resolveCanonicalAgentLink,
  selectCanonicalProviderCommand,
} from "../prisma-canonical-call-projector";

const later = new Date("2026-07-11T10:00:05.000Z");
const earlier = new Date("2026-07-11T10:00:00.000Z");

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
    providerCallLegId: "leg-1",
    providerCallSessionId: "session-1",
    providerEventId: "event-1",
    toPhone: "+17864657479",
    ...overrides,
  };
}

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
    };

    expect(() =>
      assertCanonicalProviderLegIdentity(existing, {
        providerCallControlId: "control-1",
        providerCallLegId: "leg-other",
      }),
    ).toThrow("CANONICAL_LEG_IDENTITY_MISMATCH");
    expect(() =>
      assertCanonicalProviderLegIdentity(existing, {
        providerCallControlId: "control-other",
        providerCallLegId: "leg-1",
      }),
    ).toThrow("CANONICAL_LEG_IDENTITY_MISMATCH");
    expect(() =>
      assertCanonicalProviderLegIdentity(existing, {
        providerCallControlId: "control-1",
        providerCallLegId: "leg-1",
      }),
    ).not.toThrow();
    expect(() =>
      assertCanonicalProviderLegIdentity(
        { providerCallControlId: "control-1", providerCallLegId: null },
        { providerCallControlId: "control-1", providerCallLegId: "leg-1" },
      ),
    ).not.toThrow();
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
