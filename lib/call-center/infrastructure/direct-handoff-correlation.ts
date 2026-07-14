import { normalizePhone } from "@/lib/phone";

export function directHandoffCorrelationLockKey(
  callerPhone: string,
  routePhoneNumber: string,
) {
  return `DIRECT_HANDOFF_CORRELATION:${normalizePhone(callerPhone)}:${normalizePhone(routePhoneNumber)}`;
}
