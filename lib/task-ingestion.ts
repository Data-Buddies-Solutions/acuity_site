import { Prisma } from "@/generated/prisma/client";
import { toJsonCompatible } from "@/lib/call-normalization";
import { phoneLookupVariants } from "@/lib/phone";
import { prisma } from "@/lib/prisma";

type TaskCategory = "billing" | "appointments" | "documentation" | "other";
type TaskPriority = "high_priority" | "normal" | "non_urgent";
const MAX_TASK_SUMMARY_LENGTH = 240;
const MAX_TASK_MESSAGE_LENGTH = 2500;

const categoryByInput = {
  appointments: "APPOINTMENTS",
  billing: "BILLING",
  documentation: "DOCUMENTATION",
  other: "OTHER",
} as const satisfies Record<TaskCategory, Prisma.AgentTaskCreateInput["category"]>;

const priorityByInput = {
  high_priority: "HIGH_PRIORITY",
  non_urgent: "NON_URGENT",
  normal: "NORMAL",
} as const satisfies Record<TaskPriority, Prisma.AgentTaskCreateInput["priority"]>;

const categoryByDb = {
  APPOINTMENTS: "appointments",
  BILLING: "billing",
  DOCUMENTATION: "documentation",
  OTHER: "other",
} as const;

const priorityByDb = {
  HIGH_PRIORITY: "high_priority",
  NON_URGENT: "non_urgent",
  NORMAL: "normal",
} as const;

export class TaskIngestionError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TaskIngestionError";
    this.status = status;
  }
}

type TaskPayload = {
  callId: string;
  callerPhone: string;
  category: TaskCategory;
  idempotencyKey: string;
  inboundOfficePhone?: string;
  locationId?: string;
  message: string;
  officeKey?: string;
  officePhone: string;
  patient?: {
    dob?: string;
    firstName?: string;
    id?: string;
    lastName?: string;
    name?: string;
  };
  practiceId?: string;
  source: "agent";
  summary: string;
  urgency: TaskPriority;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown, field: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new TaskIngestionError(`Missing ${field}`, 400);
}

function boundedRequiredString(value: unknown, field: string, maxLength: number) {
  const text = requiredString(value, field);
  if (text.length <= maxLength) return text;
  throw new TaskIngestionError(`${field} is too long`, 400);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseCategory(value: unknown): TaskCategory {
  if (
    value === "billing" ||
    value === "appointments" ||
    value === "documentation" ||
    value === "other"
  ) {
    return value;
  }
  throw new TaskIngestionError("Invalid category", 400);
}

function parsePriority(value: unknown): TaskPriority {
  if (value === "high_priority" || value === "normal" || value === "non_urgent") {
    return value;
  }
  throw new TaskIngestionError("Invalid urgency", 400);
}

function parsePayload(body: unknown): TaskPayload {
  const record = asRecord(body);
  if (!record) throw new TaskIngestionError("Invalid task payload", 400);

  const patientRecord = asRecord(record.patient);
  const patient = patientRecord
    ? {
        dob: optionalString(patientRecord.dob),
        firstName: optionalString(patientRecord.firstName),
        id: optionalString(patientRecord.id),
        lastName: optionalString(patientRecord.lastName),
        name: optionalString(patientRecord.name),
      }
    : undefined;

  if (record.source !== "agent") {
    throw new TaskIngestionError("Invalid source", 400);
  }

  return {
    callId: requiredString(record.callId, "callId"),
    callerPhone: requiredString(record.callerPhone, "callerPhone"),
    category: parseCategory(record.category),
    idempotencyKey: requiredString(record.idempotencyKey, "idempotencyKey"),
    inboundOfficePhone: optionalString(record.inboundOfficePhone),
    locationId: optionalString(record.locationId),
    message: boundedRequiredString(record.message, "message", MAX_TASK_MESSAGE_LENGTH),
    officeKey: optionalString(record.officeKey),
    officePhone: requiredString(record.officePhone, "officePhone"),
    patient:
      patient &&
      (patient.id || patient.name || patient.firstName || patient.lastName || patient.dob)
        ? patient
        : undefined,
    practiceId: optionalString(record.practiceId),
    source: "agent",
    summary: boundedRequiredString(record.summary, "summary", MAX_TASK_SUMMARY_LENGTH),
    urgency: parsePriority(record.urgency),
  };
}

async function resolvePracticeAndLocation(input: TaskPayload) {
  const phoneMapping = await prisma.practicePhoneNumber.findFirst({
    select: { locationId: true, practiceId: true },
    where: {
      phoneNumber: { in: phoneLookupVariants(input.officePhone) },
    },
  });

  if (!phoneMapping) {
    throw new TaskIngestionError("No practice phone mapping found", 422);
  }

  if (input.practiceId && input.practiceId !== phoneMapping.practiceId) {
    throw new TaskIngestionError("Task practice does not match office phone", 422);
  }

  const locationId = await resolveScopedLocation(phoneMapping);
  if (input.locationId && input.locationId !== locationId) {
    throw new TaskIngestionError("Task location does not match office phone", 422);
  }

  return {
    locationId,
    practiceId: phoneMapping.practiceId,
  };
}

async function resolveScopedLocation(input: {
  locationId: string | null;
  practiceId: string;
}) {
  if (input.locationId) return input.locationId;

  const locations = await prisma.practiceLocation.findMany({
    select: { id: true },
    take: 2,
    where: { practiceId: input.practiceId },
  });

  if (locations.length === 1) return locations[0].id;
  throw new TaskIngestionError("Task location could not be resolved", 422);
}

function patientName(patient: TaskPayload["patient"]) {
  if (!patient) return undefined;
  const composed = [patient.firstName, patient.lastName].filter(Boolean).join(" ");
  return patient.name ?? (composed || undefined);
}

function taskResponse(task: {
  category: keyof typeof categoryByDb;
  id: string;
  priority: keyof typeof priorityByDb;
  status?: "created" | "duplicate";
}) {
  return {
    category: categoryByDb[task.category],
    status: task.status ?? "created",
    taskId: task.id,
    urgency: priorityByDb[task.priority],
  };
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function findTaskByIdempotencyKey(idempotencyKey: string) {
  return prisma.agentTask.findUnique({
    select: {
      category: true,
      id: true,
      priority: true,
    },
    where: { idempotencyKey },
  });
}

export async function ingestLiveKitTaskPayload(body: unknown) {
  const payload = parsePayload(body);

  const existing = await findTaskByIdempotencyKey(payload.idempotencyKey);
  if (existing) return taskResponse({ ...existing, status: "duplicate" });

  const resolved = await resolvePracticeAndLocation(payload);
  const agentCall = await prisma.agentCall.findFirst({
    select: { id: true },
    where: {
      callId: payload.callId,
      practiceId: resolved.practiceId,
    },
  });

  try {
    const task = await prisma.agentTask.create({
      data: {
        agentCallId: agentCall?.id,
        callId: payload.callId,
        callerPhone: payload.callerPhone,
        category: categoryByInput[payload.category],
        idempotencyKey: payload.idempotencyKey,
        inboundOfficePhone: payload.inboundOfficePhone,
        locationId: resolved.locationId,
        message: payload.message,
        officeKey: payload.officeKey,
        officePhone: payload.officePhone,
        patientDob: payload.patient?.dob,
        patientId: payload.patient?.id,
        patientName: patientName(payload.patient),
        payload: toJsonCompatible(payload) as Prisma.InputJsonValue,
        practiceId: resolved.practiceId,
        priority: priorityByInput[payload.urgency],
        source: "AGENT",
        summary: payload.summary,
      },
      select: {
        category: true,
        id: true,
        priority: true,
      },
    });

    return taskResponse(task);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const duplicate = await findTaskByIdempotencyKey(payload.idempotencyKey);
      if (duplicate) {
        return taskResponse({ ...duplicate, status: "duplicate" });
      }
    }

    throw error;
  }
}
