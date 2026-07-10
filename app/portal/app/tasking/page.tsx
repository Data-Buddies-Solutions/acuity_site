import Link from "next/link";
import { redirect } from "next/navigation";

import { PortalBadge } from "@/app/portal/app/PortalBadge";
import { PracticePageHeader } from "@/app/portal/app/PracticePageHeader";
import { updateAgentTaskStatus } from "@/app/portal/app/tasking/actions";
import { Button } from "@/components/ui/button";
import { LinkSegmentedControl } from "@/components/ui/link-segmented-control";
import {
  getPortalTasks,
  parsePortalTaskCategory,
  parsePortalTaskOffice,
  parsePortalTaskPriority,
  parsePortalTaskStatus,
  portalTaskCategories,
  type PortalTask,
  type PortalTaskCategoryFilter,
  type PortalTaskPriorityFilter,
  type PortalTaskStatusFilter,
} from "@/lib/portal-tasks";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { cn } from "@/lib/utils";

type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;

const categoryLabels = {
  appointments: "Appointments",
  billing: "Billing",
  documentation: "Documentation",
  other: "Other",
} as const;

const priorityLabels = {
  high_priority: "High priority",
  non_urgent: "Non-urgent",
  normal: "Normal",
} as const;

const statusLabels = {
  all: "All",
  closed_no_action: "Closed",
  done: "Done",
  in_progress: "In progress",
  open: "Open",
} as const;

const statusOptions = [
  { label: "Open", value: "open" },
  { label: "In progress", value: "in_progress" },
  { label: "Done", value: "done" },
  { label: "Closed", value: "closed_no_action" },
] as const;

const priorityOptions = [
  { label: "All", value: "all" },
  { label: "High priority", value: "high_priority" },
  { label: "Normal", value: "normal" },
  { label: "Non-urgent", value: "non_urgent" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: PortalTaskPriorityFilter;
}>;

const statusFilterOptions = [
  { label: "Open", value: "open" },
  { label: "All", value: "all" },
  { label: "In progress", value: "in_progress" },
  { label: "Done", value: "done" },
  { label: "Closed", value: "closed_no_action" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: PortalTaskStatusFilter;
}>;

function taskingHref({
  category,
  office,
  priority,
  status,
}: {
  category: PortalTaskCategoryFilter;
  office: string | null;
  priority: PortalTaskPriorityFilter;
  status: PortalTaskStatusFilter;
}) {
  const params = new URLSearchParams();
  params.set("status", status);
  if (category !== "all") params.set("category", category);
  if (priority !== "all") params.set("priority", priority);
  if (office) params.set("office", office);
  return `/portal/app/tasking?${params.toString()}`;
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone || "-";
}

const taskDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "America/New_York",
});

function formatTaskDate(date: Date) {
  return taskDateFormatter.format(date);
}

function OfficeFilterNav({
  category,
  office,
  offices,
  priority,
  status,
}: {
  category: PortalTaskCategoryFilter;
  office: string | null;
  offices: Array<{ id: string; label: string }>;
  priority: PortalTaskPriorityFilter;
  status: PortalTaskStatusFilter;
}) {
  if (offices.length <= 1) return null;

  const items = [{ id: null, label: "All offices" }, ...offices];
  const selectedLabel = items.find((item) => item.id === office)?.label ?? "All offices";

  return (
    <section className="flex max-w-full flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-normal text-[var(--portal-muted-soft)]">
        Office: <span className="text-[#536a91]">{selectedLabel}</span>
      </p>
      <nav
        aria-label="Task office"
        className="flex max-w-full gap-2 overflow-x-auto pb-1"
      >
        {items.map((item) => {
          const isActive = item.id === office;
          return (
            <Link
              key={item.id ?? "all"}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "min-w-fit rounded-lg border px-3 py-2 text-sm font-medium transition",
                isActive
                  ? "!border-[#536a91] !bg-[#536a91] !text-white shadow-sm hover:!text-white"
                  : "border-[var(--portal-border)] bg-white text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]",
              )}
              href={taskingHref({
                category,
                office: item.id,
                priority,
                status,
              })}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </section>
  );
}

function TaskStatusForm({ task }: { task: PortalTask }) {
  return (
    <form action={updateAgentTaskStatus} className="flex items-center gap-2">
      <input name="taskId" type="hidden" value={task.id} />
      <select
        aria-label="Task status"
        className="h-9 rounded-lg border border-[var(--portal-border)] bg-white px-2 text-sm font-medium text-[var(--portal-ink)] outline-none focus:border-[#536a91] focus:ring-2 focus:ring-[#536a91]/15"
        defaultValue={task.status}
        name="status"
      >
        {statusOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Button size="compact" type="submit" variant="secondary">
        Update
      </Button>
    </form>
  );
}

function TaskRow({ task }: { task: PortalTask }) {
  return (
    <article className="rounded-lg border border-[var(--portal-border)] bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <PortalBadge tone={task.priority === "high_priority" ? "accent" : "neutral"}>
              {priorityLabels[task.priority]}
            </PortalBadge>
            <PortalBadge tone="soft">{statusLabels[task.status]}</PortalBadge>
            <span className="text-xs font-medium text-[var(--portal-muted)]">
              {formatTaskDate(task.createdAt)}
            </span>
          </div>
          <h3 className="text-base font-semibold leading-snug text-[var(--portal-ink)]">
            {task.summary}
          </h3>
          <p className="text-sm text-[var(--portal-muted)]">
            {task.patientLabel} · {formatPhone(task.callerPhone)} · {task.locationLabel}
          </p>
        </div>
        <TaskStatusForm task={task} />
      </div>
      <details className="mt-3 rounded-lg bg-[var(--portal-panel)] px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--portal-ink-soft)]">
          Details
        </summary>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--portal-muted)]">
          {task.message}
        </p>
        {task.callHref ? (
          <Link
            className="mt-3 inline-flex text-sm font-semibold text-[#536a91] hover:text-[#324568]"
            href={task.callHref}
          >
            Open linked call
          </Link>
        ) : null}
        <Link
          className="ml-0 mt-3 inline-flex text-sm font-semibold text-[#536a91] hover:text-[#324568] sm:ml-4"
          href={task.historyHref}
        >
          Number history
        </Link>
      </details>
    </article>
  );
}

function TaskBucket({
  category,
  tasks,
}: {
  category: (typeof portalTaskCategories)[number];
  tasks: PortalTask[];
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--portal-border)] pb-2">
        <h2 className="text-lg font-semibold text-[var(--portal-ink)]">
          {categoryLabels[category]}
        </h2>
        <PortalBadge tone={tasks.length > 0 ? "accent" : "neutral"}>
          {tasks.length}
        </PortalBadge>
      </div>
      {tasks.length > 0 ? (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--portal-border)] bg-white px-4 py-8 text-sm font-medium text-[var(--portal-muted)]">
          No {categoryLabels[category].toLowerCase()} tasks.
        </div>
      )}
    </section>
  );
}

export default async function PortalTasksPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding");
  }

  const params = searchParams ? await searchParams : {};
  const status = parsePortalTaskStatus(params.status);
  const category = parsePortalTaskCategory(params.category);
  const priority = parsePortalTaskPriority(params.priority);
  const office = parsePortalTaskOffice(params.office);
  const result = await getPortalTasks({ category, office, priority, status });

  if (!result) {
    redirect("/portal");
  }

  const renderedCategories =
    result.category === "all" ? portalTaskCategories : [result.category];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PracticePageHeader
        branding={result.branding}
        logoMeta={`${result.totalOpenTasks} open`}
        practiceName={result.practiceName}
        showLogo={false}
        title="Tasks"
      >
        <div className="flex w-full flex-col gap-3 lg:w-auto lg:items-end">
          <OfficeFilterNav
            category={result.category}
            office={result.selectedLocationId}
            offices={result.locations}
            priority={result.priority}
            status={result.status}
          />
          <div className="grid w-full gap-2 sm:grid-cols-3 lg:w-auto">
            <LinkSegmentedControl
              activeClassName="bg-[var(--portal-accent)] text-white hover:text-white"
              ariaLabel="Task status"
              className="max-w-full overflow-x-auto border border-[var(--portal-border)] bg-white"
              inactiveClassName="text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]"
              itemClassName="min-w-fit flex-1 px-3 py-1.5 text-center text-sm"
              items={statusFilterOptions.map((option) => ({
                href: taskingHref({
                  category: result.category,
                  office: result.selectedLocationId,
                  priority: result.priority,
                  status: option.value,
                }),
                label: option.label,
                value: option.value,
              }))}
              value={result.status}
            />
            <LinkSegmentedControl
              activeClassName="bg-[var(--portal-accent)] text-white hover:text-white"
              ariaLabel="Task category"
              className="max-w-full overflow-x-auto border border-[var(--portal-border)] bg-white"
              inactiveClassName="text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]"
              itemClassName="min-w-fit flex-1 px-3 py-1.5 text-center text-sm"
              items={[
                { label: "All", value: "all" as const },
                ...portalTaskCategories.map((item) => ({
                  label: categoryLabels[item],
                  value: item,
                })),
              ].map((option) => ({
                href: taskingHref({
                  category: option.value,
                  office: result.selectedLocationId,
                  priority: result.priority,
                  status: result.status,
                }),
                label: option.label,
                value: option.value,
              }))}
              value={result.category}
            />
            <LinkSegmentedControl
              activeClassName="bg-[var(--portal-accent)] text-white hover:text-white"
              ariaLabel="Task priority"
              className="max-w-full overflow-x-auto border border-[var(--portal-border)] bg-white"
              inactiveClassName="text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]"
              itemClassName="min-w-fit flex-1 px-3 py-1.5 text-center text-sm"
              items={priorityOptions.map((option) => ({
                href: taskingHref({
                  category: result.category,
                  office: result.selectedLocationId,
                  priority: option.value,
                  status: result.status,
                }),
                label: option.label,
                value: option.value,
              }))}
              value={result.priority}
            />
          </div>
        </div>
      </PracticePageHeader>

      <div className="space-y-8">
        {renderedCategories.map((item) => (
          <TaskBucket key={item} category={item} tasks={result.tasksByCategory[item]} />
        ))}
      </div>
    </div>
  );
}
