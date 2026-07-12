import type {
  ProviderCommandSender,
  ProviderSendErrorClassifier,
} from "@/lib/call-center/application/dispatch-provider-command";
import type { ProviderCommandDispatchData } from "@/lib/call-center/domain/provider-command";
import { dialTelnyxCall, TelnyxError } from "@/lib/telnyx";

export function canonicalCommandClientState(command: ProviderCommandDispatchData) {
  return Buffer.from(
    JSON.stringify({
      callId: command.callId,
      endpointId: command.arguments.endpointId,
      internalSeatLeg: true,
      legId: command.legId,
    }),
    "utf8",
  ).toString("base64");
}

export const telnyxProviderCommandSender: ProviderCommandSender = {
  async send(command) {
    await dialTelnyxCall({
      bridgeIntent: true,
      bridgeOnAnswer: true,
      clientState: canonicalCommandClientState(command),
      commandId: command.commandId,
      connectionId: command.provider.connectionId,
      from: command.provider.from,
      linkTo: command.provider.linkTo,
      preventDoubleBridge: true,
      timeoutSecs: command.provider.timeoutSeconds,
      to: command.provider.sipUri,
    });
  },
};

export const telnyxProviderSendErrorClassifier: ProviderSendErrorClassifier = {
  classify(error) {
    if (error instanceof TelnyxError) {
      if (error.status === 401 || error.status === 403) {
        return { category: "TERMINAL", code: "PROVIDER_AUTHORIZATION_FAILED" };
      }
      if (error.status === 408) {
        return { category: "RETRYABLE", code: "SENDING_OUTCOME_AMBIGUOUS" };
      }
      if (error.status === 429) {
        return { category: "RETRYABLE", code: "PROVIDER_RATE_LIMITED" };
      }
      if (error.status >= 500) {
        return { category: "RETRYABLE", code: "SENDING_OUTCOME_AMBIGUOUS" };
      }
      if (error.status >= 400) {
        return { category: "TERMINAL", code: "PROVIDER_VALIDATION_FAILED" };
      }
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return { category: "RETRYABLE", code: "SENDING_OUTCOME_AMBIGUOUS" };
    }
    return { category: "UNKNOWN", code: "PROVIDER_UNKNOWN" };
  },
};
