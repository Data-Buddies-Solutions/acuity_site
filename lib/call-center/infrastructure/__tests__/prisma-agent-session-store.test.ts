import { describe, expect, it } from "bun:test";

import { isConnectedAgentCallLeg } from "../prisma-agent-session-store";

describe("connected agent call occupancy", () => {
  it("does not mark an answered transfer target busy before bridge evidence", () => {
    expect(
      isConnectedAgentCallLeg({
        callDirection: "INBOUND",
        callStatus: "CONNECTED",
        callWinningLegId: "source-leg",
        legId: "target-leg",
        legStatus: "ANSWERED",
      }),
    ).toBe(false);
    expect(
      isConnectedAgentCallLeg({
        callDirection: "OUTBOUND",
        callStatus: "CONNECTED",
        callWinningLegId: "source-leg",
        legId: "target-leg",
        legStatus: "ANSWERED",
      }),
    ).toBe(false);
  });

  it("preserves outbound answer and provider-bridged occupancy", () => {
    expect(
      isConnectedAgentCallLeg({
        callDirection: "OUTBOUND",
        callStatus: "CONNECTED",
        callWinningLegId: null,
        legId: "outbound-leg",
        legStatus: "ANSWERED",
      }),
    ).toBe(true);
    expect(
      isConnectedAgentCallLeg({
        callDirection: "INBOUND",
        callStatus: "CONNECTED",
        callWinningLegId: "agent-leg",
        legId: "agent-leg",
        legStatus: "BRIDGED",
      }),
    ).toBe(true);
  });
});
