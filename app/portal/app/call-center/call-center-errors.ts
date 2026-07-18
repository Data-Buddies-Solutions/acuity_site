import {
  CallCenterRequestError,
  type CallCenterErrorCode,
  type CallCenterErrorEnvelope,
  isCallCenterErrorEnvelope,
} from "@/lib/call-center/operator-error";

export type CallCenterAction =
  | "connect"
  | "enable"
  | "end"
  | "hold"
  | "keypad"
  | "mute"
  | "outbound"
  | "queue"
  | "readiness"
  | "save"
  | "take"
  | "transfer"
  | "voicemail";

export type OperatorErrorCopy = {
  message: string;
  presentation: "banner" | "inline";
  retryable: boolean;
};

type CatalogEntry = Omit<OperatorErrorCopy, "retryable"> & {
  includeReference?: boolean;
  retryable?: boolean;
};

const catalog: Partial<Record<CallCenterErrorCode, CatalogEntry>> = {
  ACCESS_DENIED: {
    message:
      "You do not have access to this calling queue. Ask an administrator to update your access.",
    presentation: "banner",
  },
  AUTH_REQUIRED: {
    message: "Your sign-in expired. Sign in again, then retry.",
    presentation: "banner",
  },
  BROWSER_AUDIO_REQUIRED: {
    message: "Browser audio is blocked. Allow sound, then select Ready again.",
    presentation: "inline",
    retryable: true,
  },
  CALL_ALREADY_CLAIMED: {
    message: "Call taken by another agent",
    presentation: "inline",
    includeReference: false,
  },
  CALL_CENTER_SESSION_IN_USE: {
    message: "Phone active in another tab",
    presentation: "banner",
    includeReference: false,
  },
  CALL_NOT_CONNECTED: {
    message: "Call ended",
    presentation: "inline",
    includeReference: false,
  },
  CALL_NOT_FOUND: {
    message: "Call ended",
    presentation: "inline",
    includeReference: false,
  },
  CALL_NOT_READY: {
    message: "You are not ready for calls. Select Ready, then try again.",
    presentation: "inline",
    retryable: true,
  },
  CALLING_NOT_CONFIGURED: {
    message:
      "Calling is not configured for this login. Ask an administrator to assign your calling endpoint and queue access.",
    presentation: "banner",
  },
  INVALID_REQUEST: {
    message: "Check the information and try again.",
    presentation: "inline",
  },
  MICROPHONE_REQUIRED: {
    message:
      "Microphone access is required. Allow microphone access, then select Ready again.",
    presentation: "inline",
    retryable: true,
  },
  NETWORK_LOST: {
    message: "The network connection was lost. Reconnect, then try again.",
    presentation: "banner",
    retryable: true,
  },
  OUTBOUND_CALL_FAILED: {
    message: "The call could not be started. Check the number, then try again.",
    presentation: "inline",
    retryable: true,
  },
  OUTBOUND_NUMBER_INVALID: {
    message: "Check the phone number and try again.",
    presentation: "inline",
  },
  PROVIDER_UNAVAILABLE: {
    message: "The phone service is temporarily unavailable. Try again in a moment.",
    presentation: "banner",
    retryable: true,
  },
  QUEUE_UNAVAILABLE: {
    message: "This call queue is no longer available. Refresh and choose another queue.",
    presentation: "banner",
  },
  REQUEST_TIMEOUT: {
    message: "The action took too long. Try again.",
    presentation: "inline",
    retryable: true,
  },
  SESSION_EXPIRED: {
    message: "Your calling session ended. Select Ready to reconnect.",
    presentation: "banner",
    retryable: true,
  },
  SESSION_STALE: {
    message: "The call center changed while you were working. Refresh and try again.",
    presentation: "inline",
    retryable: true,
  },
  TEMPORARY_SERVICE_FAILURE: {
    message: "The call center is temporarily unavailable. Try again in a moment.",
    presentation: "banner",
    retryable: true,
  },
  TRANSFER_IN_PROGRESS: {
    message: "A transfer is already in progress. Wait for it to finish.",
    presentation: "inline",
    retryable: true,
  },
  TRANSFER_TARGET_UNAVAILABLE: {
    message: "That team member cannot take the call right now. Choose someone else.",
    presentation: "inline",
    retryable: true,
  },
  VOICEMAIL_UNAVAILABLE: {
    message: "This voicemail recording is not available. Try again later.",
    presentation: "inline",
    retryable: true,
  },
};

const actionPhrase: Record<CallCenterAction, string> = {
  connect: "connect to the call center",
  enable: "enable calling",
  end: "end this call",
  hold: "update hold",
  keypad: "send that keypad entry",
  mute: "update mute",
  outbound: "start this call",
  queue: "complete that queue action",
  readiness: "get ready for calls",
  save: "save that update",
  take: "answer this call",
  transfer: "transfer this call",
  voicemail: "load this voicemail",
};

function fallback(action: CallCenterAction, referenceId?: string) {
  const support = referenceId
    ? ` If it keeps happening, contact support with reference ${referenceId}.`
    : " If it keeps happening, contact support.";
  return `We couldn't ${actionPhrase[action]}. Try again.${support}`;
}

export function operatorErrorCopy(
  error: unknown,
  action: CallCenterAction,
): OperatorErrorCopy {
  if (!(error instanceof CallCenterRequestError)) {
    return { message: fallback(action), presentation: "inline", retryable: true };
  }
  const entry = catalog[error.operatorError.code];
  const message = entry?.message ?? fallback(action, error.operatorError.referenceId);
  const reference =
    entry?.includeReference !== false && error.operatorError.referenceId
      ? ` Reference: ${error.operatorError.referenceId}.`
      : "";
  return {
    message: `${message}${reference}`,
    presentation: entry?.presentation ?? "inline",
    retryable: entry?.retryable ?? error.operatorError.retryable,
  };
}

export async function callCenterResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const operatorError: CallCenterErrorEnvelope["error"] = isCallCenterErrorEnvelope(
      body,
    )
      ? body.error
      : {
          code: "UNKNOWN_FAILURE",
          referenceId: response.headers.get("x-call-center-reference") ?? "",
          retryable: response.status >= 500,
        };
    throw new CallCenterRequestError(operatorError);
  }
  if (body === null) {
    throw new CallCenterRequestError({
      code: "UNKNOWN_FAILURE",
      referenceId: "",
      retryable: true,
    });
  }
  return body as T;
}

export function localCallCenterError(code: CallCenterErrorCode, retryable = true) {
  return new CallCenterRequestError({ code, referenceId: "", retryable });
}
