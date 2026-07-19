import type {
  CallCenterAgentConnectionState,
  CallCenterAgentPresence,
} from "@/generated/prisma/client";
import type { AgentSessionView } from "@/lib/call-center/realtime-contract";

type AgentSessionWireSource = {
  audioReady: boolean;
  clientInstanceId: string;
  connectionState: CallCenterAgentConnectionState;
  endpointId: string;
  id: string;
  leaseExpiresAt: Date;
  microphoneReady: boolean;
  presence: CallCenterAgentPresence;
  stateVersion: number;
};

const CONNECTION_STATE_WIRE: Record<
  CallCenterAgentConnectionState,
  AgentSessionView["connectionState"]
> = {
  CLOSED: "DISCONNECTED",
  CONNECTING: "CONNECTING",
  ERROR: "FAILED",
  READY: "READY",
};

export function serializeAgentConnectionState(
  state: CallCenterAgentConnectionState,
): AgentSessionView["connectionState"] {
  return CONNECTION_STATE_WIRE[state];
}

export function normalizeAgentPresence(
  presence: CallCenterAgentPresence,
): AgentSessionView["presence"] {
  return presence === "WRAP_UP" ? "BUSY" : presence;
}

export function serializeAgentSessionView(
  session: AgentSessionWireSource,
): AgentSessionView {
  return {
    audioReady: session.audioReady,
    clientInstanceId: session.clientInstanceId,
    connectionState: serializeAgentConnectionState(session.connectionState),
    endpointId: session.endpointId,
    id: session.id,
    leaseExpiresAt: session.leaseExpiresAt.toISOString(),
    microphoneReady: session.microphoneReady,
    presence: normalizeAgentPresence(session.presence),
    stateVersion: session.stateVersion,
  };
}
