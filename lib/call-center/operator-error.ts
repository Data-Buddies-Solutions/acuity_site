const CALL_CENTER_ERROR_CODES = [
  "ACCESS_DENIED",
  "AUTH_REQUIRED",
  "BROWSER_AUDIO_REQUIRED",
  "CALL_CENTER_SESSION_IN_USE",
  "CALL_NOT_CONNECTED",
  "CALL_NOT_FOUND",
  "CALL_NOT_READY",
  "CALLING_NOT_CONFIGURED",
  "INVALID_REQUEST",
  "MICROPHONE_REQUIRED",
  "NETWORK_LOST",
  "OUTBOUND_CALL_FAILED",
  "OUTBOUND_NUMBER_INVALID",
  "PROVIDER_UNAVAILABLE",
  "QUEUE_UNAVAILABLE",
  "REQUEST_TIMEOUT",
  "SESSION_EXPIRED",
  "SESSION_STALE",
  "TEMPORARY_SERVICE_FAILURE",
  "UNKNOWN_FAILURE",
  "VOICEMAIL_UNAVAILABLE",
] as const;

export type CallCenterErrorCode = (typeof CALL_CENTER_ERROR_CODES)[number];

export type CallCenterErrorEnvelope = {
  error: {
    code: CallCenterErrorCode;
    referenceId: string;
    retryable: boolean;
  };
};

const errorCodes = new Set<string>(CALL_CENTER_ERROR_CODES);

export function isCallCenterErrorEnvelope(
  value: unknown,
): value is CallCenterErrorEnvelope {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    errorCodes.has(error.code) &&
    "referenceId" in error &&
    typeof error.referenceId === "string" &&
    /^[A-Z0-9]{6,12}$/.test(error.referenceId) &&
    "retryable" in error &&
    typeof error.retryable === "boolean",
  );
}

export class CallCenterRequestError extends Error {
  constructor(readonly operatorError: CallCenterErrorEnvelope["error"]) {
    super(operatorError.code);
    this.name = "CallCenterRequestError";
  }
}
