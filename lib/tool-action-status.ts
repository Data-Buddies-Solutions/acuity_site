export type ToolActionLike = {
  isError?: boolean | null;
  name?: string | null;
  result?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function parseToolResult(value: unknown) {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isSuccessfulBookAppointmentTool(tool: ToolActionLike) {
  if (tool.name !== "book_appt" || tool.isError === true) return false;

  const result = parseToolResult(tool.result);
  if (!result) return false;

  const status = asString(result.status)?.toLowerCase();
  if (status === "error") return false;
  if (status === "booked") return true;

  return Boolean(
    asString(result.appointmentId) ??
    asString(result.id) ??
    (result.ok === true ? "true" : null),
  );
}

export function isSuccessfulRescheduleAppointmentTool(tool: ToolActionLike) {
  if (tool.name !== "reschedule_appt" || tool.isError === true) return false;

  const result = parseToolResult(tool.result);
  if (!result) return false;

  const status = asString(result.status)?.toLowerCase();
  if (status === "error") return false;

  const appointmentId = asString(result.appointmentId) ?? asString(result.id);
  if (!appointmentId) return false;

  return (
    status === "rescheduled" ||
    asString(result.cancelledAppointmentId) !== null ||
    asString(result.cancellationStatus)?.toLowerCase() === "cancelled"
  );
}

export function isSuccessfulTransferCallTool(tool: ToolActionLike) {
  if (tool.name !== "transfer_call" || tool.isError === true) return false;

  const result = parseToolResult(tool.result);
  const resultText = asString(tool.result)?.toLowerCase() ?? null;
  if (!result && !resultText) return false;

  if (result) {
    const status = asString(result.status)?.toLowerCase();
    const outputClass = asString(result.outputClass)?.toLowerCase();
    const resultClass = asString(result.result)?.toLowerCase();

    if (status === "error" || outputClass === "error" || resultClass === "error") {
      return false;
    }

    return (
      result.ok === true ||
      result.transferred === true ||
      result.transferStarted === true ||
      result.transfer_started === true ||
      status === "transfer_started" ||
      status === "started" ||
      status === "transferred" ||
      outputClass === "transfer_started" ||
      resultClass === "transfer_started"
    );
  }

  if (resultText) {
    if (
      resultText.includes("could not transfer") ||
      resultText.includes("transfer failed") ||
      resultText.includes("transfer was interrupted") ||
      resultText.includes("no active sip session")
    ) {
      return false;
    }

    if (
      resultText === "ok" ||
      resultText.includes("transfer started") ||
      resultText.includes("transfer already started")
    ) {
      return true;
    }
  }

  return false;
}

export function isSuccessfulAppointmentBookingTool(tool: ToolActionLike) {
  return (
    isSuccessfulBookAppointmentTool(tool) || isSuccessfulRescheduleAppointmentTool(tool)
  );
}

export function isSuccessfulToolAction(tool: ToolActionLike) {
  if (tool.isError === true) return false;
  if (tool.name === "book_appt") return isSuccessfulBookAppointmentTool(tool);
  if (tool.name === "reschedule_appt") {
    return isSuccessfulRescheduleAppointmentTool(tool);
  }
  if (tool.name === "transfer_call") return isSuccessfulTransferCallTool(tool);
  return true;
}
