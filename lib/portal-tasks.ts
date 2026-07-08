import {
  AgentTaskCategory,
  AgentTaskPriority,
  AgentTaskStatus,
} from "@/generated/prisma/client";
import {
  buildPortalAgentCallScopeWhere,
  buildPortalLocationScopeWhere,
  canAccessPortalLocation,
  filterPortalLocationsForAccess,
  getCurrentPortalPracticeContext,
} from "@/lib/portal-access";
import { getPracticeBranding, type PracticeBranding } from "@/lib/practice-branding";
import { prisma } from "@/lib/prisma";

export type PortalTaskStatusFilter =
  "all" | "open" | "in_progress" | "done" | "closed_no_action";
export type PortalTaskCategoryFilter =
  "all" | "billing" | "appointments" | "documentation" | "other";
export type PortalTaskPriorityFilter = "all" | "high_priority" | "normal" | "non_urgent";

export type PortalTask = {
  callHref: string | null;
  callId: string;
  callerPhone: string;
  category: Exclude<PortalTaskCategoryFilter, "all">;
  createdAt: Date;
  historyHref: string;
  id: string;
  locationLabel: string;
  message: string;
  patientLabel: string;
  priority: Exclude<PortalTaskPriorityFilter, "all">;
  status: Exclude<PortalTaskStatusFilter, "all">;
  summary: string;
};

export type PortalTasksResult = {
  branding: PracticeBranding;
  category: PortalTaskCategoryFilter;
  locations: Array<{ id: string; label: string }>;
  practiceName: string;
  priority: PortalTaskPriorityFilter;
  selectedLocationId: string | null;
  selectedLocationLabel: string | null;
  status: PortalTaskStatusFilter;
  tasksByCategory: Record<Exclude<PortalTaskCategoryFilter, "all">, PortalTask[]>;
  totalOpenTasks: number;
};

const categoryFromDb = {
  [AgentTaskCategory.APPOINTMENTS]: "appointments",
  [AgentTaskCategory.BILLING]: "billing",
  [AgentTaskCategory.DOCUMENTATION]: "documentation",
  [AgentTaskCategory.OTHER]: "other",
} as const;

const priorityFromDb = {
  [AgentTaskPriority.HIGH_PRIORITY]: "high_priority",
  [AgentTaskPriority.NORMAL]: "normal",
  [AgentTaskPriority.NON_URGENT]: "non_urgent",
} as const;

const statusFromDb = {
  [AgentTaskStatus.CLOSED_NO_ACTION]: "closed_no_action",
  [AgentTaskStatus.DONE]: "done",
  [AgentTaskStatus.IN_PROGRESS]: "in_progress",
  [AgentTaskStatus.OPEN]: "open",
} as const;

const categoryToDb = {
  appointments: AgentTaskCategory.APPOINTMENTS,
  billing: AgentTaskCategory.BILLING,
  documentation: AgentTaskCategory.DOCUMENTATION,
  other: AgentTaskCategory.OTHER,
} as const;

const priorityToDb = {
  high_priority: AgentTaskPriority.HIGH_PRIORITY,
  non_urgent: AgentTaskPriority.NON_URGENT,
  normal: AgentTaskPriority.NORMAL,
} as const;

const statusToDb = {
  closed_no_action: AgentTaskStatus.CLOSED_NO_ACTION,
  done: AgentTaskStatus.DONE,
  in_progress: AgentTaskStatus.IN_PROGRESS,
  open: AgentTaskStatus.OPEN,
} as const;

export const portalTaskCategories = [
  "billing",
  "appointments",
  "documentation",
  "other",
] as const satisfies ReadonlyArray<Exclude<PortalTaskCategoryFilter, "all">>;

export function parsePortalTaskStatus(
  value: string | string[] | undefined,
): PortalTaskStatusFilter {
  return value === "all" ||
    value === "open" ||
    value === "in_progress" ||
    value === "done" ||
    value === "closed_no_action"
    ? value
    : "open";
}

export function parsePortalTaskCategory(
  value: string | string[] | undefined,
): PortalTaskCategoryFilter {
  return value === "all" ||
    value === "billing" ||
    value === "appointments" ||
    value === "documentation" ||
    value === "other"
    ? value
    : "all";
}

export function parsePortalTaskPriority(
  value: string | string[] | undefined,
): PortalTaskPriorityFilter {
  return value === "all" ||
    value === "high_priority" ||
    value === "normal" ||
    value === "non_urgent"
    ? value
    : "all";
}

export function parsePortalTaskOffice(value: string | string[] | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatPatientLabel(task: { callerPhone: string; patientName: string | null }) {
  return task.patientName?.trim() || task.callerPhone;
}

function emptyBuckets(): PortalTasksResult["tasksByCategory"] {
  return {
    appointments: [],
    billing: [],
    documentation: [],
    other: [],
  };
}

export async function getPortalTasks(input: {
  category: PortalTaskCategoryFilter;
  office: string | null;
  priority: PortalTaskPriorityFilter;
  status: PortalTaskStatusFilter;
}): Promise<PortalTasksResult | null> {
  const context = await getCurrentPortalPracticeContext();
  if (!context) return null;

  const visibleLocations = filterPortalLocationsForAccess(
    context,
    context.practice.locations,
  ).map((location) => ({ id: location.id, label: location.name }));
  const selectedLocation = input.office
    ? (visibleLocations.find((location) => location.id === input.office) ?? null)
    : null;

  const locationWhere =
    selectedLocation && canAccessPortalLocation(context, selectedLocation.id)
      ? { locationId: selectedLocation.id }
      : buildPortalLocationScopeWhere(context);

  const where = {
    practiceId: context.practice.id,
    ...locationWhere,
    ...(input.status === "all" ? {} : { status: statusToDb[input.status] }),
    ...(input.category === "all" ? {} : { category: categoryToDb[input.category] }),
    ...(input.priority === "all" ? {} : { priority: priorityToDb[input.priority] }),
  };

  const [tasks, totalOpenTasks] = await Promise.all([
    prisma.agentTask.findMany({
      include: {
        agentCall: {
          select: { callId: true },
        },
        location: {
          select: { name: true },
        },
      },
      orderBy: [{ category: "asc" }, { priority: "asc" }, { createdAt: "desc" }],
      take: 200,
      where,
    }),
    prisma.agentTask.count({
      where: {
        practiceId: context.practice.id,
        ...locationWhere,
        status: AgentTaskStatus.OPEN,
      },
    }),
  ]);

  const availableCallIds = new Set(
    (
      await prisma.agentCall.findMany({
        select: { callId: true },
        where: {
          AND: [
            {
              callId: {
                in: [...new Set(tasks.map((task) => task.callId).filter(Boolean))],
              },
              practiceId: context.practice.id,
            },
            buildPortalAgentCallScopeWhere(context),
          ],
        },
      })
    ).map((call) => call.callId),
  );

  const buckets = emptyBuckets();
  for (const task of tasks) {
    const category = categoryFromDb[task.category];
    const callId =
      task.agentCall?.callId ?? (availableCallIds.has(task.callId) ? task.callId : null);
    buckets[category].push({
      callHref: callId ? `/portal/app/calls/${encodeURIComponent(callId)}` : null,
      callId: task.callId,
      callerPhone: task.callerPhone,
      category,
      createdAt: task.createdAt,
      historyHref: `/portal/app/call-center/callers/${encodeURIComponent(task.callerPhone)}`,
      id: task.id,
      locationLabel: task.location?.name ?? "Unassigned",
      message: task.message,
      patientLabel: formatPatientLabel(task),
      priority: priorityFromDb[task.priority],
      status: statusFromDb[task.status],
      summary: task.summary,
    });
  }

  return {
    branding: getPracticeBranding(context.practice),
    category: input.category,
    locations: visibleLocations,
    practiceName: context.practice.name,
    priority: input.priority,
    selectedLocationId: selectedLocation?.id ?? null,
    selectedLocationLabel: selectedLocation?.label ?? null,
    status: input.status,
    tasksByCategory: buckets,
    totalOpenTasks,
  };
}
