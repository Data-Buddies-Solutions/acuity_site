import { describe, expect, it } from "bun:test";

import type { CanonicalTelnyxCallFact } from "../telnyx-canonical-call-fact";
import {
  assertCanonicalProviderLegIdentity,
  earliestObservedAt,
  enrichCanonicalCallIdentity,
  resolveCanonicalAgentLink,
} from "../prisma-canonical-call-projector";

const later = new Date("2026-07-11T10:00:05.000Z");
const earlier = new Date("2026-07-11T10:00:00.000Z");

function fact(overrides: Partial<CanonicalTelnyxCallFact> = {}): CanonicalTelnyxCallFact {
  return {
    callerName: "Patient Name",
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
