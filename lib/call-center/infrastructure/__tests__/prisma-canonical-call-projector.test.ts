import { describe, expect, it } from "bun:test";

import { impliedOutboundAgentBridgeLegId } from "../prisma-canonical-call-projector";

describe("outbound canonical bridge evidence", () => {
  it("connects the exact answered browser leg when its customer peer is bridged", () => {
    expect(
      impliedOutboundAgentBridgeLegId({
        agentLegs: [
          {
            id: "agent-leg-1",
            providerCallSessionId: "provider-session-1",
            status: "ANSWERED",
          },
        ],
        callDirection: "OUTBOUND",
        currentWinningLegId: null,
        eventType: "call.bridged",
        processedLegKind: "CUSTOMER",
        processedLegProviderCallSessionId: "provider-session-1",
        processedLegStatus: "BRIDGED",
      }),
    ).toBe("agent-leg-1");
  });

  it("fails closed when the customer bridge cannot identify one exact agent leg", () => {
    const input = {
      agentLegs: [
        {
          id: "agent-leg-1",
          providerCallSessionId: "provider-session-1",
          status: "ANSWERED" as const,
        },
        {
          id: "agent-leg-2",
          providerCallSessionId: "provider-session-1",
          status: "ANSWERED" as const,
        },
      ],
      callDirection: "OUTBOUND" as const,
      currentWinningLegId: null,
      eventType: "call.bridged",
      processedLegKind: "CUSTOMER" as const,
      processedLegProviderCallSessionId: "provider-session-1",
      processedLegStatus: "BRIDGED" as const,
    };

    expect(impliedOutboundAgentBridgeLegId(input)).toBeNull();
    expect(
      impliedOutboundAgentBridgeLegId({
        ...input,
        agentLegs: input.agentLegs.slice(0, 1),
        processedLegProviderCallSessionId: "different-session",
      }),
    ).toBeNull();
  });
});
