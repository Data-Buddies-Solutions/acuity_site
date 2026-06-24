import type { AppointmentActionAnalytics, AppointmentAnalytics } from "@/lib/call-types";

const BOOK_APPOINTMENT_TOOL_NAMES = new Set(["book_appt", "book_appointment"]);
const RESCHEDULE_APPOINTMENT_TOOL_NAMES = new Set([
  "reschedule_appt",
  "reschedule_appointment",
]);
const CANCEL_APPOINTMENT_TOOL_NAMES = new Set(["cancel_appt", "cancel_appointment"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isBookAppointmentToolName(name: unknown) {
  return typeof name === "string" && BOOK_APPOINTMENT_TOOL_NAMES.has(name);
}

export function isRescheduleAppointmentToolName(name: unknown) {
  return typeof name === "string" && RESCHEDULE_APPOINTMENT_TOOL_NAMES.has(name);
}

export function isCancelAppointmentToolName(name: unknown) {
  return typeof name === "string" && CANCEL_APPOINTMENT_TOOL_NAMES.has(name);
}

export function appointmentActionFromToolName(
  name: unknown,
): AppointmentActionAnalytics["action"] | null {
  if (isBookAppointmentToolName(name)) return "booked";
  if (isRescheduleAppointmentToolName(name)) return "rescheduled";
  if (isCancelAppointmentToolName(name)) return "cancelled";
  return null;
}

export function appointmentActionFromOutputClass(
  outputClass: unknown,
): AppointmentActionAnalytics["action"] | null {
  if (outputClass === "appointment_booked") return "booked";
  if (outputClass === "appointment_rescheduled") return "rescheduled";
  if (outputClass === "appointment_cancelled") return "cancelled";
  return null;
}

export function isResolvedAppointmentAction(action: AppointmentActionAnalytics) {
  return action.status !== "error";
}

function normalizeAppointment(value: unknown): AppointmentAnalytics | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const appointment: AppointmentAnalytics = {
    ...(asString(value.appointmentId)
      ? { appointmentId: asString(value.appointmentId)! }
      : {}),
    ...(stringField(value.patientName)
      ? { patientName: stringField(value.patientName)! }
      : {}),
    ...(stringField(value.appointmentDate)
      ? { appointmentDate: stringField(value.appointmentDate)! }
      : {}),
    ...(stringField(value.appointmentTime)
      ? { appointmentTime: stringField(value.appointmentTime)! }
      : {}),
    ...(stringField(value.startDatetime)
      ? { startDatetime: stringField(value.startDatetime)! }
      : {}),
    ...(stringField(value.providerName)
      ? { providerName: stringField(value.providerName)! }
      : {}),
    ...(stringField(value.locationName)
      ? { locationName: stringField(value.locationName)! }
      : {}),
    ...(stringField(value.appointmentTypeName)
      ? { appointmentTypeName: stringField(value.appointmentTypeName)! }
      : {}),
    ...(stringField(value.careLane) ? { careLane: stringField(value.careLane)! } : {}),
  };

  return Object.keys(appointment).length > 0 ? appointment : undefined;
}

export function normalizeAppointmentActions(
  value: unknown,
): AppointmentActionAnalytics[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const actions: AppointmentActionAnalytics[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const action =
      item.action === "booked" ||
      item.action === "rescheduled" ||
      item.action === "cancelled"
        ? item.action
        : null;
    const status =
      item.status === "success" || item.status === "partial" || item.status === "error"
        ? item.status
        : null;
    if (!action || !status) {
      continue;
    }

    const appointment = normalizeAppointment(item.appointment);
    const cancelledAppointment = normalizeAppointment(item.cancelledAppointment);

    actions.push({
      action,
      status,
      ...(stringField(item.toolName) ? { toolName: stringField(item.toolName)! } : {}),
      ...(stringField(item.createdAt) ? { createdAt: stringField(item.createdAt)! } : {}),
      ...(stringField(item.message) ? { message: stringField(item.message)! } : {}),
      ...(appointment ? { appointment } : {}),
      ...(cancelledAppointment ? { cancelledAppointment } : {}),
    });
  }

  return actions;
}

export function getAppointmentActions(data: unknown): AppointmentActionAnalytics[] {
  return isRecord(data) ? normalizeAppointmentActions(data.appointmentActions) : [];
}

export function hasRenderableAppointmentDetails(
  appointment: AppointmentAnalytics | null,
) {
  return Boolean(
    appointment?.appointmentId ||
    appointment?.patientName ||
    appointment?.appointmentDate ||
    appointment?.appointmentTime ||
    appointment?.startDatetime ||
    appointment?.providerName ||
    appointment?.locationName ||
    appointment?.appointmentTypeName,
  );
}
