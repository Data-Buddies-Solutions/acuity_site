import type {
  CallCenterAgentConnectionState,
  CallCenterAgentPresence,
} from "@/generated/prisma/client";
import type { AgentSessionView } from "@/lib/call-center/realtime-contract";

type AgentSessionWireSource = {
  audioReady: boolean;
  clientInstanceId: string;
  connectionState: CallCenterAgentConnectionState;
  currentCallId: string | null;
  offeredCallId: string | null;
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

export function serializeAgentSessionView(
  session: AgentSessionWireSource,
): AgentSessionView {
  return {
    audioReady: session.audioReady,
    clientInstanceId: session.clientInstanceId,
    connectionState: serializeAgentConnectionState(session.connectionState),
    currentCallId: session.currentCallId,
    offeredCallId: session.offeredCallId,
    endpointId: session.endpointId,
    id: session.id,
    leaseExpiresAt: session.leaseExpiresAt.toISOString(),
    microphoneReady: session.microphoneReady,
    presence: session.presence,
    stateVersion: session.stateVersion,
  };
}
