import { NextResponse } from "next/server";

import { ApiError, ValidationError } from "@/lib/api/handler";
import {
  type CallCenterErrorCode,
  type CallCenterErrorEnvelope,
} from "@/lib/call-center/operator-error";
import { createLogger, type LogContext } from "@/lib/logger";
import { TelnyxError } from "@/lib/telnyx";

const logger = createLogger("portal-call-center-errors");

export class CallCenterOperatorError extends Error {
  constructor(
    readonly code: CallCenterErrorCode,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(code);
    this.name = "CallCenterOperatorError";
  }
}

type Failure = {
  code: CallCenterErrorCode;
  retryable: boolean;
  status: number;
};

type HandlerOptions = {
  errorCode: CallCenterErrorCode;
  logLabel: string;
  reportFailure?: (message: string, context: LogContext) => void;
  retryable?: boolean;
};

const knownMessages: Record<string, Omit<Failure, "status">> = {
  "Agent queue membership is required": {
    code: "ACCESS_DENIED",
    retryable: false,
  },
  "Agent session expired; reconnect it": { code: "SESSION_EXPIRED", retryable: true },
  "Agent session is not active; reconnect it": {
    code: "SESSION_EXPIRED",
    retryable: true,
  },
  "Agent session is not ready to claim calls": {
    code: "CALL_NOT_READY",
    retryable: true,
  },
  "Agent session state is stale": { code: "SESSION_STALE", retryable: true },
  "Agent session changed; refresh and try again": {
    code: "SESSION_STALE",
    retryable: true,
  },
  "Another transfer is already in progress": {
    code: "TRANSFER_IN_PROGRESS",
    retryable: true,
  },
  "AVAILABLE requires browser audio": {
    code: "BROWSER_AUDIO_REQUIRED",
    retryable: true,
  },
  "AVAILABLE requires microphone access": {
    code: "MICROPHONE_REQUIRED",
    retryable: true,
  },
  "AVAILABLE requires a ready provider connection": {
    code: "PROVIDER_UNAVAILABLE",
    retryable: true,
  },
  "AVAILABLE requires no active call": { code: "CALL_NOT_READY", retryable: true },
  "Call is no longer available to claim": {
    code: "CALL_ALREADY_CLAIMED",
    retryable: false,
  },
  "Call was already answered": { code: "CALL_ALREADY_CLAIMED", retryable: false },
  "Call center queue not found": { code: "QUEUE_UNAVAILABLE", retryable: false },
  "Calling is not configured for this agent": {
    code: "CALLING_NOT_CONFIGURED",
    retryable: false,
  },
  "Calling is not configured for this user": {
    code: "CALLING_NOT_CONFIGURED",
    retryable: false,
  },
  "Canonical agent session is not ready for outbound calling": {
    code: "CALL_NOT_READY",
    retryable: true,
  },
  "Canonical agent session is unavailable": {
    code: "SESSION_EXPIRED",
    retryable: true,
  },
  "Canonical agent session not found": { code: "SESSION_EXPIRED", retryable: true },
  "Canonical call not found": { code: "CALL_NOT_FOUND", retryable: false },
  "Canonical routing does not own this call": {
    code: "CALL_NOT_FOUND",
    retryable: false,
  },
  "Call changed; refresh and try again": { code: "SESSION_STALE", retryable: true },
  "Call is not ready for disposition": { code: "CALL_NOT_READY", retryable: true },
  "Choose a different agent": { code: "TRANSFER_TARGET_UNAVAILABLE", retryable: false },
  "Endpoint is not eligible for this queue": { code: "ACCESS_DENIED", retryable: false },
  "Endpoint is not eligible for this user": { code: "ACCESS_DENIED", retryable: false },
  "Existing claim is missing its provider command": {
    code: "TEMPORARY_SERVICE_FAILURE",
    retryable: true,
  },
  "Existing claim session is inconsistent": {
    code: "TEMPORARY_SERVICE_FAILURE",
    retryable: true,
  },
  "Idempotency key was already used for another target": {
    code: "INVALID_REQUEST",
    retryable: false,
  },
  "One or more follow-up tasks changed": { code: "SESSION_STALE", retryable: true },
  "Only a connected canonical call can transfer": {
    code: "CALL_NOT_CONNECTED",
    retryable: false,
  },
  "Outbound phone numbers must be valid E.164": {
    code: "OUTBOUND_NUMBER_INVALID",
    retryable: false,
  },
  "Outbound number is outside this queue scope": {
    code: "ACCESS_DENIED",
    retryable: false,
  },
  "Only inbound calls can be claimed": { code: "CALL_NOT_FOUND", retryable: false },
  "Queue membership is required": { code: "ACCESS_DENIED", retryable: false },
  "That staff member is not available for transfer": {
    code: "TRANSFER_TARGET_UNAVAILABLE",
    retryable: true,
  },
  "Source agent does not own the connected call": {
    code: "ACCESS_DENIED",
    retryable: false,
  },
  "This user is already active in another browser": {
    code: "CALL_CENTER_SESSION_IN_USE",
    retryable: false,
  },
  "Transfer target changed; refresh and try again": {
    code: "TRANSFER_TARGET_UNAVAILABLE",
    retryable: true,
  },
  "Transfer target is already occupied": {
    code: "TRANSFER_TARGET_UNAVAILABLE",
    retryable: true,
  },
  "Transfer target is not configured": {
    code: "TRANSFER_TARGET_UNAVAILABLE",
    retryable: false,
  },
  "Transfer target is not ready": {
    code: "TRANSFER_TARGET_UNAVAILABLE",
    retryable: true,
  },
  "Transfer target is not an eligible queue agent": {
    code: "TRANSFER_TARGET_UNAVAILABLE",
    retryable: false,
  },
  "Transfer target is outside the call scope": {
    code: "TRANSFER_TARGET_UNAVAILABLE",
    retryable: false,
  },
  "Transfer target is outside its location scope": {
    code: "TRANSFER_TARGET_UNAVAILABLE",
    retryable: false,
  },
  Unauthorized: { code: "AUTH_REQUIRED", retryable: false },
};

function statusOf(error: unknown) {
  return error instanceof Error &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
    ? (error as { status: number }).status
    : 500;
}

function classify(error: unknown, options: HandlerOptions): Failure {
  if (error instanceof CallCenterOperatorError) {
    return { code: error.code, retryable: error.retryable, status: error.status };
  }

  const status = statusOf(error);
  if (error instanceof Error && knownMessages[error.message]) {
    return { ...knownMessages[error.message], status };
  }
  if (error instanceof ValidationError || (error instanceof ApiError && status < 500)) {
    return { code: "INVALID_REQUEST", retryable: false, status };
  }
  if (error instanceof TelnyxError) {
    return { code: "PROVIDER_UNAVAILABLE", retryable: status >= 500, status };
  }
  if (status === 401) return { code: "AUTH_REQUIRED", retryable: false, status };
  if (status === 403) return { code: "ACCESS_DENIED", retryable: false, status };
  if (status === 503 || status === 504) {
    return { code: "TEMPORARY_SERVICE_FAILURE", retryable: true, status };
  }
  return {
    code: options.errorCode,
    retryable: options.retryable ?? status >= 500,
    status,
  };
}

function requestId(request: Request | undefined) {
  return (
    request?.headers.get("x-request-id")?.trim() ||
    request?.headers.get("x-vercel-id")?.trim() ||
    null
  );
}

function referenceId(request: Request | undefined) {
  const existing = requestId(request)?.toUpperCase();
  if (existing && /^[A-Z0-9]{6,12}$/.test(existing)) return existing;
  return crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
}

function safeCause(error: unknown) {
  if (!(error instanceof Error)) return { causeName: typeof error };
  const causeCode =
    "code" in error && typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
  const causeMessage = knownMessages[error.message] ? error.message : undefined;
  const causeStack = error.stack?.split("\n").slice(1, 7).join("\n");
  return { causeCode, causeMessage, causeName: error.name, causeStack };
}

export function reportCallCenterError(
  error: unknown,
  request: Request | undefined,
  options: HandlerOptions,
): { envelope: CallCenterErrorEnvelope; status: number } {
  const failure = classify(error, options);
  const ref = referenceId(request);
  const context: LogContext = {
    ...safeCause(error),
    errorCode: failure.code,
    referenceId: ref,
    requestId: requestId(request),
    retryable: failure.retryable,
    status: failure.status,
  };
  (options.reportFailure ?? logger.error)(options.logLabel, context);
  return {
    envelope: {
      error: {
        code: failure.code,
        referenceId: ref,
        retryable: failure.retryable,
      },
    },
    status: failure.status,
  };
}

export function withCallCenterApiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
  options: HandlerOptions,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      const request = args[0] instanceof Request ? args[0] : undefined;
      const failure = reportCallCenterError(error, request, options);
      return NextResponse.json(failure.envelope, { status: failure.status });
    }
  };
}
