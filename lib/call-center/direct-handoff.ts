import {
  DIRECT_HANDOFF_TTL_MS,
  resolveDirectHandoffConfig,
  type DirectHandoffConfig,
} from "@/lib/call-center/infrastructure/direct-handoff-config";

export { DIRECT_HANDOFF_TTL_MS, resolveDirectHandoffConfig };
export type { DirectHandoffConfig };

export type ReserveDirectHandoffInput = {
  callerPhone: string;
  idempotencyKey: string;
  practiceId: string;
  routePhoneNumber: string;
  sourceCallId: string;
};

export type AcceptDirectHandoffInput = Omit<ReserveDirectHandoffInput, "practiceId">;
