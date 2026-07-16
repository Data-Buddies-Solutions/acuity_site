import type {
  ProviderCommandSender,
  ProviderSendErrorClassifier,
} from "@/lib/call-center/application/dispatch-provider-command";
import type { ProviderCommandDispatchData } from "@/lib/call-center/domain/provider-command";
import { ringbackWavBase64For } from "@/lib/call-center/infrastructure/ringback-audio";
import {
  answerTelnyxCall,
  dialTelnyxCall,
  hangupTelnyxCall,
  speakOnTelnyxCall,
  startTelnyxPlayback,
  startTelnyxRecording,
  stopTelnyxPlayback,
  TelnyxError,
} from "@/lib/telnyx";

export function canonicalCommandClientState(command: ProviderCommandDispatchData) {
  return Buffer.from(
    JSON.stringify({
      callId: command.callId,
      canonicalCommand: true,
      commandId: command.commandId,
      ...(command.type === "DIAL_AGENT"
        ? {
            endpointId: command.arguments.endpointId,
            internalSeatLeg: true,
          }
        : {}),
      legId: command.legId,
    }),
    "utf8",
  ).toString("base64");
}

type TelnyxCommandOperations = {
  answer: typeof answerTelnyxCall;
  dial: typeof dialTelnyxCall;
  hangup: typeof hangupTelnyxCall;
  playbackStart: typeof startTelnyxPlayback;
  playbackStop: typeof stopTelnyxPlayback;
  recordStart: typeof startTelnyxRecording;
  ringbackContent: typeof ringbackWavBase64For;
  speak: typeof speakOnTelnyxCall;
};

const telnyxOperations: TelnyxCommandOperations = {
  answer: answerTelnyxCall,
  dial: dialTelnyxCall,
  hangup: hangupTelnyxCall,
  playbackStart: startTelnyxPlayback,
  playbackStop: stopTelnyxPlayback,
  recordStart: startTelnyxRecording,
  ringbackContent: ringbackWavBase64For,
  speak: speakOnTelnyxCall,
};

function requireSuccessfulResponse(response: Response, action: string) {
  if (!response.ok) {
    throw new TelnyxError(`Telnyx ${action} command failed`, response.status);
  }
}

export function createTelnyxProviderCommandSender(
  operations: TelnyxCommandOperations = telnyxOperations,
): ProviderCommandSender {
  return {
    async send(command: ProviderCommandDispatchData) {
      switch (command.type) {
        case "ANSWER_CUSTOMER":
          requireSuccessfulResponse(
            await operations.answer(
              command.provider.callControlId,
              command.commandId,
              undefined,
              canonicalCommandClientState(command),
            ),
            "answer",
          );
          return;
        case "START_RINGBACK":
          requireSuccessfulResponse(
            await operations.playbackStart({
              callControlId: command.provider.callControlId,
              clientState: canonicalCommandClientState(command),
              commandId: command.commandId,
              loop: 1,
              playbackContent: operations.ringbackContent(
                command.arguments.timeoutSeconds,
              ),
            }),
            "ringback",
          );
          return;
        case "DIAL_AGENT":
          await operations.dial({
            bridgeIntent: true,
            bridgeOnAnswer: true,
            clientState: canonicalCommandClientState(command),
            commandId: command.commandId,
            connectionId: command.provider.connectionId,
            from: command.provider.from,
            linkTo: command.provider.linkTo,
            preventDoubleBridge: !command.arguments.replacesLegId,
            timeoutSecs: command.provider.timeoutSeconds,
            to: command.provider.sipUri,
          });
          return;
        case "STOP_PLAYBACK": {
          const response = await operations.playbackStop(
            command.provider.callControlId,
            command.commandId,
            undefined,
            canonicalCommandClientState(command),
          );
          if (![404, 422].includes(response.status)) {
            requireSuccessfulResponse(response, "playback stop");
          }
          return;
        }
        case "HANGUP_LEG":
          try {
            await operations.hangup(
              command.provider.callControlId,
              command.commandId,
              undefined,
              canonicalCommandClientState(command),
            );
          } catch (error) {
            if (!(error instanceof TelnyxError) || ![404, 422].includes(error.status)) {
              throw error;
            }
          }
          return;
        case "PLAY_VOICEMAIL_GREETING":
          requireSuccessfulResponse(
            await operations.speak({
              callControlId: command.provider.callControlId,
              clientState: canonicalCommandClientState(command),
              commandId: command.commandId,
              payload: command.arguments.greeting,
            }),
            "voicemail greeting",
          );
          return;
        case "START_RECORDING":
          await operations.recordStart({
            callControlId: command.provider.callControlId,
            clientState: canonicalCommandClientState(command),
            commandId: command.commandId,
            playBeep: true,
          });
      }
    },
  };
}

export const telnyxProviderCommandSender = createTelnyxProviderCommandSender();

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
