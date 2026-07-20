import type {
  ProviderCommandSender,
  ProviderSendErrorClassifier,
} from "@/lib/call-center/application/dispatch-provider-command";
import type { ProviderCommandDispatchData } from "@/lib/call-center/domain/provider-command";
import { holdMusicWavBase64 } from "@/lib/call-center/infrastructure/hold-music";
import { ringbackWavBase64For } from "@/lib/call-center/infrastructure/ringback-audio";
import {
  answerTelnyxCall,
  dialTelnyxCall,
  hangupTelnyxCall,
  speakOnTelnyxCall,
  startTelnyxPlayback,
  startTelnyxRecording,
  stopTelnyxPlayback,
  transferTelnyxCall,
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
            internalAgentLeg: true,
          }
        : {}),
      legId: command.legId,
    }),
    "utf8",
  ).toString("base64");
}

export function transferCommandClientStates(
  command: Extract<ProviderCommandDispatchData, { type: "TRANSFER_AGENT" }>,
) {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  const common = {
    callId: command.callId,
    canonicalCommand: true,
    commandId: command.commandId,
  };
  return {
    source: encode({
      ...common,
      ...(command.arguments.providerSourceLegId === command.arguments.sourceLegId
        ? { internalAgentLeg: true }
        : {}),
      internalTransferSource: true,
      legId: command.arguments.providerSourceLegId,
    }),
    target: encode({
      ...common,
      endpointId: command.arguments.endpointId,
      internalAgentLeg: true,
      internalTransferTarget: true,
      legId: command.legId,
    }),
  };
}

type TelnyxCommandOperations = {
  answer: typeof answerTelnyxCall;
  dial: typeof dialTelnyxCall;
  hangup: typeof hangupTelnyxCall;
  holdMusicContent: typeof holdMusicWavBase64;
  playbackStart: typeof startTelnyxPlayback;
  playbackStop: typeof stopTelnyxPlayback;
  recordStart: typeof startTelnyxRecording;
  ringbackContent: typeof ringbackWavBase64For;
  speak: typeof speakOnTelnyxCall;
  transfer: typeof transferTelnyxCall;
  waitForHoldReplayWindow: () => Promise<void>;
};

const HOLD_REPLAY_GUARD_MS = 1_000;

const telnyxOperations: TelnyxCommandOperations = {
  answer: answerTelnyxCall,
  dial: dialTelnyxCall,
  hangup: hangupTelnyxCall,
  holdMusicContent: holdMusicWavBase64,
  playbackStart: startTelnyxPlayback,
  playbackStop: stopTelnyxPlayback,
  recordStart: startTelnyxRecording,
  ringbackContent: ringbackWavBase64For,
  speak: speakOnTelnyxCall,
  transfer: transferTelnyxCall,
  waitForHoldReplayWindow: () =>
    new Promise((resolve) => setTimeout(resolve, HOLD_REPLAY_GUARD_MS)),
};

function requireSuccessfulResponse(response: Response, action: string) {
  if (!response.ok) {
    throw new TelnyxError(`Telnyx ${action} command failed`, response.status);
  }
}

export function createTelnyxProviderCommandSender(
  overrides: Partial<TelnyxCommandOperations> = {},
): ProviderCommandSender {
  const operations = { ...telnyxOperations, ...overrides };
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
            preventDoubleBridge: true,
            timeoutSecs: command.provider.timeoutSeconds,
            to: command.provider.sipUri,
          });
          return;
        case "TRANSFER_AGENT": {
          const clientStates = transferCommandClientStates(command);
          requireSuccessfulResponse(
            await operations.transfer({
              callControlId: command.provider.callControlId,
              clientState: clientStates.source,
              commandId: command.commandId,
              targetLegClientState: clientStates.target,
              timeoutSecs: command.provider.timeoutSeconds,
              to: command.provider.sipUri,
            }),
            "transfer",
          );
          return;
        }
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
        case "START_HOLD_MUSIC":
          requireSuccessfulResponse(
            await operations.playbackStart({
              audioType: "wav",
              callControlId: command.provider.callControlId,
              clientState: canonicalCommandClientState(command),
              commandId: command.commandId,
              loop: "infinity",
              playbackContent: operations.holdMusicContent(),
              targetLegs: "opposite",
            }),
            "hold music",
          );
          return;
        case "STOP_HOLD_MUSIC": {
          const clientState = canonicalCommandClientState(command);
          const response = await operations.playbackStop(
            command.provider.callControlId,
            command.commandId,
            undefined,
            clientState,
          );
          const firstStopAlreadySettled = [404, 422].includes(response.status);
          if (!firstStopAlreadySettled) {
            requireSuccessfulResponse(response, "hold music stop");
          }

          // Telnyx briefly ends and restarts an infinite playback at the WAV loop
          // boundary. A stop accepted inside that gap can miss the scheduled replay,
          // so clear the queue once more after the observed replay window.
          await operations.waitForHoldReplayWindow();
          const guardedResponse = await operations.playbackStop(
            command.provider.callControlId,
            undefined,
            undefined,
            clientState,
          );
          const guardedStopAlreadySettled = [404, 422].includes(guardedResponse.status);
          if (!guardedStopAlreadySettled) {
            requireSuccessfulResponse(guardedResponse, "hold music stop");
          }
          if (guardedStopAlreadySettled) {
            return { alreadySettled: true };
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
        return { code: "PROVIDER_AUTHORIZATION_FAILED" };
      }
      if (error.status === 408) {
        return { code: "SENDING_OUTCOME_AMBIGUOUS" };
      }
      if (error.status === 429) {
        return { code: "PROVIDER_RATE_LIMITED" };
      }
      if (error.status >= 500) {
        return { code: "SENDING_OUTCOME_AMBIGUOUS" };
      }
      if (error.status >= 400) {
        return { code: "PROVIDER_VALIDATION_FAILED" };
      }
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return { code: "SENDING_OUTCOME_AMBIGUOUS" };
    }
    return { code: "PROVIDER_UNKNOWN" };
  },
};
