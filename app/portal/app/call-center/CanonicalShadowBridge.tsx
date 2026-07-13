"use client";

import { useEffect, useState } from "react";

import type { AgentSessionView } from "@/lib/call-center/realtime-contract";

import {
  claimCallCenterClientInstance,
  type CallCenterClientInstance,
} from "./call-center-client-instance";
import {
  type CanonicalAgentConnectionState,
  useCanonicalAgentSession,
} from "./use-canonical-agent-session";
import { useCanonicalCallCenter } from "./use-canonical-call-center";

type CanonicalShadowBridgeProps = {
  audioReady: boolean;
  connectionState: CanonicalAgentConnectionState;
  endpointId: string | null;
  microphoneReady: boolean;
  presence: AgentSessionView["presence"];
  queueId: string;
};

export default function CanonicalShadowBridge(props: CanonicalShadowBridgeProps) {
  const [client, setClient] = useState<CallCenterClientInstance | null>(null);
  const [identityFailed, setIdentityFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let claimed: CallCenterClientInstance | null = null;

    void claimCallCenterClientInstance()
      .then((next) => {
        if (!active) {
          next.release();
          return;
        }
        claimed = next;
        setClient(next);
      })
      .catch(() => {
        if (active) setIdentityFailed(true);
      });

    return () => {
      active = false;
      claimed?.release();
    };
  }, []);

  if (identityFailed) return <CanonicalShadowStatus status="unavailable" />;
  if (!client) return <CanonicalShadowStatus status="connecting" />;

  return (
    <ConnectedCanonicalShadowBridge
      {...props}
      clientInstanceId={client.clientInstanceId}
    />
  );
}

function ConnectedCanonicalShadowBridge({
  audioReady,
  clientInstanceId,
  connectionState,
  endpointId,
  microphoneReady,
  presence,
  queueId,
}: CanonicalShadowBridgeProps & { clientInstanceId: string }) {
  const realtime = useCanonicalCallCenter({ clientInstanceId, queueId });
  const { error, session, start, stop } = useCanonicalAgentSession({
    audioReady,
    clientInstanceId,
    connectionState,
    microphoneReady,
    presence,
  });
  const shadowActive = realtime.state?.queue.routingMode === "SHADOW";

  useEffect(() => {
    if (endpointId && presence !== "OFFLINE" && shadowActive) {
      void start();
    } else {
      void stop();
    }

    return () => {
      void stop();
    };
  }, [endpointId, presence, shadowActive, start, stop]);

  if (realtime.state && !shadowActive) return null;
  if (realtime.error || error) {
    return <CanonicalShadowStatus status="unavailable" />;
  }
  if (realtime.loading || !realtime.state) {
    return <CanonicalShadowStatus status="connecting" />;
  }

  return (
    <CanonicalShadowStatus
      active={realtime.state.counts.active}
      agentReady={session?.connectionState === "READY"}
      revision={realtime.state.revision}
      status={realtime.state.connection === "CONNECTED" ? "synced" : "connecting"}
      waiting={realtime.state.counts.waiting}
    />
  );
}

type CanonicalShadowStatusProps = {
  active?: number;
  agentReady?: boolean;
  revision?: string;
  status: "connecting" | "synced" | "unavailable";
  waiting?: number;
};

export function CanonicalShadowStatus({
  active = 0,
  agentReady = false,
  revision,
  status,
  waiting = 0,
}: CanonicalShadowStatusProps) {
  const label =
    status === "synced"
      ? `Synced${agentReady ? " · station ready" : ""}`
      : status === "connecting"
        ? "Connecting"
        : "Unavailable";

  return (
    <section
      aria-label="Canonical shadow diagnostics"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dashed border-[var(--portal-border)] bg-[var(--portal-panel)] px-3 py-2 text-xs text-[var(--portal-muted)]"
    >
      <span className="font-medium text-[var(--portal-ink)]">New call center shadow</span>
      <span>{label}</span>
      {status === "synced" ? (
        <>
          <span>{waiting} waiting</span>
          <span>{active} active</span>
          {revision ? <span>Revision {revision}</span> : null}
        </>
      ) : null}
    </section>
  );
}
