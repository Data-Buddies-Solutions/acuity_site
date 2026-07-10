const SAFE_FIELDS = new Set([
  "classifiedInbound",
  "classifiedOutbound",
  "direction",
  "hasClient",
  "hasDestination",
  "hasRemoteStream",
  "isAnswerPending",
  "state",
  "status",
  "timeoutMs",
]);

export function sanitizeCallCenterDebugDetails(details: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(details).flatMap(([key, value]) => {
      if (!SAFE_FIELDS.has(key)) {
        return [];
      }

      if (
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string" ||
        value === null
      ) {
        return [[key, value]];
      }

      return [];
    }),
  );
}
