import type {
  CallCenterAgentConnectionState,
  CallCenterAgentPresence,
} from "@/generated/prisma/client";

export type AgentSessionReadiness = {
  audioReady: boolean;
  connectionState: CallCenterAgentConnectionState;
  microphoneReady: boolean;
  presence: CallCenterAgentPresence;
};

export function isAgentSessionReady(state: AgentSessionReadiness) {
  return (
    state.presence === "AVAILABLE" &&
    state.connectionState === "READY" &&
    state.microphoneReady &&
    state.audioReady
  );
}

export function resolveAgentSessionReadyAt(
  state: AgentSessionReadiness,
  currentReadyAt: Date | null,
  now: Date,
) {
  return isAgentSessionReady(state) ? (currentReadyAt ?? now) : null;
}

export function readinessValidationError(state: AgentSessionReadiness) {
  if (state.presence !== "AVAILABLE" || isAgentSessionReady(state)) {
    return null;
  }

  if (state.connectionState !== "READY") {
    return "AVAILABLE requires a ready provider connection";
  }

  if (!state.microphoneReady) {
    return "AVAILABLE requires microphone access";
  }

  if (!state.audioReady) {
    return "AVAILABLE requires browser audio";
  }

  return null;
}
