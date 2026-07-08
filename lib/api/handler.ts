import { NextResponse } from "next/server";

import {
  getCurrentPortalPracticeContext,
  type PortalPracticeAccessContext,
} from "@/lib/portal-access";
import { TelnyxError } from "@/lib/telnyx";

/**
 * Typed error that route handlers (and shared helpers) can throw to produce a
 * JSON error response with a specific status code. The shared handler wrapper
 * maps it to `{ error, detail? }`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(message: string, status = 500, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

type NormalizedHttpError = {
  status: number;
  message: string;
  detail?: string;
};

function asHttpError(error: unknown): NormalizedHttpError | null {
  if (error instanceof ApiError || error instanceof TelnyxError) {
    return { detail: error.detail, message: error.message, status: error.status };
  }

  // Other domain errors (e.g. CallIngestionError) expose a numeric status.
  if (
    error instanceof Error &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return {
      message: error.message,
      status: (error as { status: number }).status,
    };
  }

  return null;
}

type ApiHandlerOptions = {
  /** Message returned to the client for unexpected (500) failures. */
  errorMessage: string;
  /** Log label used when an unexpected error is logged. Defaults to errorMessage. */
  logLabel?: string;
};

function toErrorResponse(error: unknown, options: ApiHandlerOptions): NextResponse {
  const httpError = asHttpError(error);

  if (httpError) {
    const body: { error: string; detail?: string } = { error: httpError.message };

    if (httpError.detail !== undefined) {
      body.detail = httpError.detail;
    }

    return NextResponse.json(body, { status: httpError.status });
  }

  console.error(options.logLabel ?? options.errorMessage, error);
  return NextResponse.json({ error: options.errorMessage }, { status: 500 });
}

/**
 * Wraps an App Router route handler so thrown errors are mapped to JSON
 * responses: `ApiError`/`TelnyxError` (and other errors carrying a numeric
 * `status`) become `{ error, detail? }` with that status, and anything else is
 * logged and returned as a 500 with `errorMessage`.
 */
export function withApiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
  options: ApiHandlerOptions,
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return toErrorResponse(error, options);
    }
  };
}

/**
 * Parses the JSON body of a request, throwing a 400 `ApiError` when the body is
 * not valid JSON.
 */
export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError("Invalid JSON", 400);
  }
}

export type PortalCallCenterContext = Omit<PortalPracticeAccessContext, "practice"> & {
  practice: Omit<PortalPracticeAccessContext["practice"], "callCenterSettings"> & {
    callCenterSettings: NonNullable<
      PortalPracticeAccessContext["practice"]["callCenterSettings"]
    >;
  };
};

/**
 * Resolves the current portal call-center context or throws a typed error:
 * 401 when there is no authenticated practice context, and 403 when the
 * practice has not enabled the call center. The returned context is narrowed so
 * `practice.callCenterSettings` is guaranteed to be present.
 */
export async function requirePortalCallCenterContext(): Promise<PortalCallCenterContext> {
  const context = await getCurrentPortalPracticeContext();

  if (!context) {
    throw new ApiError("Unauthorized", 401);
  }

  if (!context.practice.callCenterSettings?.enabled) {
    throw new ApiError("Call center is not enabled for this practice", 403);
  }

  return context as PortalCallCenterContext;
}
