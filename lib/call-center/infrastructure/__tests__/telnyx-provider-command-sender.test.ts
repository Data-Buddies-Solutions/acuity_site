import { describe, expect, it } from "bun:test";

import type { ProviderCommandDispatchData } from "@/lib/call-center/domain/provider-command";
import { TelnyxError } from "@/lib/telnyx";

import {
  canonicalCommandClientState,
  telnyxProviderSendErrorClassifier,
} from "../telnyx-provider-command-sender";

const command: ProviderCommandDispatchData = {
  arguments: { agentSessionId: "session-1", endpointId: "endpoint-1" },
  callId: "call-1",
  commandId: "command-1",
  idempotencyKey: "dial:leg-1",
  legId: "leg-1",
  practiceId: "practice-1",
  provider: {
    connectionId: "connection-1",
    from: "+17865550101",
    linkTo: "customer-control-1",
    sipUri: "sip:agent-1@example.test",
    timeoutSeconds: 20,
  },
  type: "DIAL_AGENT",
};

describe("Telnyx provider command sender", () => {
  it("encodes only stable canonical correlation IDs", () => {
    expect(
      JSON.parse(
        Buffer.from(canonicalCommandClientState(command), "base64").toString("utf8"),
      ),
    ).toEqual({
      callId: "call-1",
      endpointId: "endpoint-1",
      internalSeatLeg: true,
      legId: "leg-1",
    });
  });

  it("classifies provider failures without persisting provider detail", () => {
    expect(
      telnyxProviderSendErrorClassifier.classify(
        new TelnyxError("secret response", 429, "secret detail"),
      ),
    ).toEqual({ category: "RETRYABLE", code: "PROVIDER_RATE_LIMITED" });
    expect(
      telnyxProviderSendErrorClassifier.classify(
        new TelnyxError("secret response", 422, "secret detail"),
      ),
    ).toEqual({ category: "TERMINAL", code: "PROVIDER_VALIDATION_FAILED" });
    expect(
      telnyxProviderSendErrorClassifier.classify(
        new TelnyxError("secret response", 503, "secret detail"),
      ),
    ).toEqual({ category: "RETRYABLE", code: "SENDING_OUTCOME_AMBIGUOUS" });
  });
});
