import type { CallView } from "@/lib/call-center/realtime-contract";

export function callCounterpartyPhone(call: CallView) {
  return call.direction === "OUTBOUND" ? call.toPhone : call.fromPhone;
}
