"use server";

import {
  getPortalCallTranscript,
  type PortalCallTranscript,
} from "@/lib/portal-overview";

export type BookingCallDetails = Pick<
  PortalCallTranscript,
  "completeness" | "durationSec" | "messages"
>;

export async function loadBookingCallDetails(
  callId: string,
): Promise<BookingCallDetails | null> {
  const normalizedCallId = callId.trim();
  if (!normalizedCallId) return null;

  const transcript = await getPortalCallTranscript(normalizedCallId);
  if (!transcript) return null;

  return {
    completeness: transcript.completeness,
    durationSec: transcript.durationSec,
    messages: transcript.messages,
  };
}
