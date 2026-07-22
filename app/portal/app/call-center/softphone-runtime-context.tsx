"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { AgentAvailabilityIntent } from "@/lib/call-center/domain/agent-session-readiness";
import type { AgentSessionView } from "@/lib/call-center/realtime-contract";

import type { useIncomingCallRingtone } from "./use-incoming-call-ringtone";
import type { useSoftphoneMedia } from "./use-softphone";

export type SoftphoneRuntimeValue = {
  availabilityError: string | null;
  availabilityIntent: AgentAvailabilityIntent;
  availabilityPending: boolean;
  availabilityRetryable: boolean;
  clientInstanceId: string | null;
  error: string | null;
  media: Omit<ReturnType<typeof useSoftphoneMedia>, "setRemoteAudioElement">;
  ringtone: ReturnType<typeof useIncomingCallRingtone>;
  session: AgentSessionView | null;
  answer(mediaLegId: string, expiresAt?: string): Promise<void>;
  answeringMediaLegId: string | null;
  retryAvailability(): Promise<void>;
  setAvailability(presence: AgentAvailabilityIntent): Promise<void>;
  setOutboundOperationActive(
    active: boolean,
    identity?: { callId: string; legId: string },
    options?: { releaseProvisionalSuppression?: boolean },
  ): void;
  takeover(): Promise<void>;
};

const SoftphoneContext = createContext<SoftphoneRuntimeValue | null>(null);

export function SoftphoneRuntimeProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: SoftphoneRuntimeValue;
}) {
  return <SoftphoneContext.Provider value={value}>{children}</SoftphoneContext.Provider>;
}

export function useSoftphoneRuntime() {
  const runtime = useContext(SoftphoneContext);
  if (!runtime) {
    throw new Error("Softphone Runtime is not mounted");
  }
  return runtime;
}
