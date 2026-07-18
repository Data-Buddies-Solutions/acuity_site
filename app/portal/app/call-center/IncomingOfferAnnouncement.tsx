"use client";

import type { CallView } from "@/lib/call-center/realtime-contract";
import { formatPhone } from "@/lib/format";

import { callCounterpartyPhone } from "./canonical-call-presentation";

export function IncomingOfferAnnouncement({
  call,
  queueName,
}: {
  call: CallView | null;
  queueName: string;
}) {
  const caller = call
    ? call.callerName || formatPhone(callCounterpartyPhone(call))
    : null;

  return (
    <p aria-atomic="true" aria-live="assertive" className="sr-only" role="status">
      {caller ? `Incoming call from ${caller} for ${queueName}.` : ""}
    </p>
  );
}
