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
  return true;
}
