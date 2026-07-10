export function isLegacyPresenceReadyForCalls({
  readyForCalls,
  status,
}: {
  readyForCalls: boolean;
  status: string;
}) {
  return status === "AVAILABLE" && readyForCalls;
}

export function canWriteLegacyPresence(input: {
  readyForCalls: boolean;
  status: string;
}) {
  return input.status !== "AVAILABLE" || isLegacyPresenceReadyForCalls(input);
}
