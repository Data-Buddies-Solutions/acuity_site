import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, ChevronRight, Play, RotateCcw, X } from "lucide-react";

import { PortalBadge } from "@/app/portal/app/PortalBadge";
import { PortalQuerySelect } from "@/app/portal/app/PortalQuerySelect";
import { PracticePageHeader } from "@/app/portal/app/PracticePageHeader";
import { updateAgentTaskStatus } from "@/app/portal/app/tasking/actions";
import { Button } from "@/components/ui/button";
import { LinkSegmentedControl } from "@/components/ui/link-segmented-control";
import {
  getPortalTasks,
  parsePortalTaskCategory,
  parsePortalTaskOffice,
  parsePortalTaskPriority,
  portalTaskCategories,
  type PortalTask,
  type PortalTaskCategoryFilter,
  type PortalTaskPriorityFilter,
  type PortalTaskStatusFilter,
} from "@/lib/portal-tasks";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { cn } from "@/lib/utils";

type SearchParamsInput = Promise<Record<string, string | string[] | undefined>>;
type TaskView = "active" | "completed" | "dismissed";

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

const priorityOptions = [
  { label: "All priorities", value: "" },
  { label: "High priority", value: "high_priority" },
  { label: "Normal", value: "normal" },
  { label: "Non-urgent", value: "non_urgent" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: "" | Exclude<PortalTaskPriorityFilter, "all">;
}>;

const viewOptions = [
  { label: "Active", value: "active" },
  { label: "Completed", value: "completed" },
  { label: "Dismissed", value: "dismissed" },
] as const satisfies ReadonlyArray<{ label: string; value: TaskView }>;

const priorityRank = {
  high_priority: 0,
  normal: 1,
  non_urgent: 2,
} as const;

function parseView(value: string | string[] | undefined): TaskView {
  return value === "completed" || value === "dismissed" ? value : "active";
}

function statusesForView(view: TaskView): PortalTaskStatusFilter[] {
  if (view === "completed") return ["done"];
  if (view === "dismissed") return ["closed_no_action"];
  return ["open", "in_progress"];
}

function taskingHref({
  category,
  office,
  priority,
  view,
}: {
  category: PortalTaskCategoryFilter;
  office: string | null;
  priority: PortalTaskPriorityFilter;
  view: TaskView;
}) {
  const params = new URLSearchParams();
  if (view !== "active") params.set("view", view);
  if (category !== "all") params.set("category", category);
  if (priority !== "all") params.set("priority", priority);
  if (office) params.set("office", office);
  const query = params.toString();
  return `/portal/app/tasking${query ? `?${query}` : ""}`;
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone || "—";
}

const taskDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "America/New_York",
});

function formatTaskAge(createdAt: Date) {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - createdAt.getTime()) / 60_000),
  );
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function TaskActionForm({ task }: { task: PortalTask }) {
  const isActive = task.status === "open" || task.status === "in_progress";
  const nextStatus = task.status === "open" ? "in_progress" : "done";
  const primaryLabel = task.status === "open" ? "Start" : "Complete";
  const PrimaryIcon = task.status === "open" ? Play : Check;

  if (!isActive) {
    return (
      <form action={updateAgentTaskStatus}>
        <input name="taskId" type="hidden" value={task.id} />
        <Button name="status" size="sm" value="open" variant="outline">
          <RotateCcw />
          Reopen
        </Button>
      </form>
    );
  }

  return (
    <form action={updateAgentTaskStatus} className="flex items-center gap-1.5">
      <input name="taskId" type="hidden" value={task.id} />
      <Button
        aria-label={`Dismiss ${task.summary}`}
        className="text-[var(--portal-muted)]"
        name="status"
        size="icon"
        title="Dismiss"
        value="closed_no_action"
        variant="ghost"
      >
        <X />
      </Button>
      <Button name="status" size="sm" value={nextStatus} variant="primary">
        <PrimaryIcon />
        {primaryLabel}
      </Button>
    </form>
  );
}

function TaskRow({ task }: { task: PortalTask }) {
  const patientIsPhone = task.patientLabel === task.callerPhone;
  const isActive = task.status === "open" || task.status === "in_progress";

  return (
    <article className="relative grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-4 left-0 w-1 rounded-r-full",
          task.priority === "high_priority"
            ? "bg-[var(--portal-danger)]"
            : task.priority === "normal"
              ? "bg-[var(--portal-accent)]"
              : "bg-[var(--portal-border-strong)]",
        )}
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <PortalBadge tone={task.priority === "high_priority" ? "accent" : "neutral"}>
            {priorityLabels[task.priority]}
          </PortalBadge>
          <PortalBadge tone="soft">{categoryLabels[task.category]}</PortalBadge>
          {task.status === "in_progress" ? (
            <PortalBadge tone="accent">In progress</PortalBadge>
          ) : null}
          <span className="text-xs text-[var(--portal-muted)]">
            {isActive
              ? `Waiting ${formatTaskAge(task.createdAt)}`
              : taskDateFormatter.format(task.createdAt)}
          </span>
        </div>
        <h2 className="mt-2 text-base font-semibold leading-snug text-[var(--portal-ink)]">
          {task.summary}
        </h2>
        <p className="mt-1 text-sm text-[var(--portal-muted)]">
          <span className="font-medium text-[var(--portal-ink-soft)]">
            {task.patientLabel}
          </span>
          {!patientIsPhone ? (
            <>
              <span aria-hidden="true"> · </span>
              <span className="whitespace-nowrap font-mono text-xs tabular-nums">
                {formatPhone(task.callerPhone)}
              </span>
            </>
          ) : null}
          <span aria-hidden="true"> · </span>
          {task.locationLabel}
        </p>
        <details className="group mt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-[var(--portal-accent)] hover:text-[var(--portal-accent-hover)]">
            Details
            <ChevronRight
              className="size-4 transition group-open:rotate-90"
              aria-hidden="true"
            />
          </summary>
          <div className="mt-3 max-w-3xl border-l-2 border-[var(--portal-border)] pl-3">
            <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--portal-muted)]">
              {task.message}
            </p>
            <div className="mt-2 flex flex-wrap gap-4">
              {task.callHref ? (
                <Link
                  className="text-sm font-medium text-[var(--portal-accent)]"
                  href={task.callHref}
                >
                  Open linked call
                </Link>
              ) : null}
              <Link
                className="text-sm font-medium text-[var(--portal-accent)]"
                href={task.historyHref}
              >
                Number history
              </Link>
            </div>
          </div>
        </details>
      </div>
      <div className="flex justify-end lg:pt-1">
        <TaskActionForm task={task} />
      </div>
    </article>
  );
}

export default async function PortalTasksPage({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const portalState = await getPortalWorkspaceState();
  if (!portalState.launched) redirect("/portal/app/onboarding");

  const params = searchParams ? await searchParams : {};
  const view = parseView(params.view);
  const category = parsePortalTaskCategory(params.category);
  const priority = parsePortalTaskPriority(params.priority);
  const office = parsePortalTaskOffice(params.office);
  const results = await Promise.all(
    statusesForView(view).map((status) =>
      getPortalTasks({ category, office, priority, status }),
    ),
  );
  const result = results[0];

  if (!result || results.some((item) => !item)) redirect("/portal");

  const tasks = portalTaskCategories
    .flatMap((category) =>
      results.flatMap((item) => item?.tasksByCategory[category] ?? []),
    )
    .sort((left, right) => {
      const priorityDifference =
        priorityRank[left.priority] - priorityRank[right.priority];
      return priorityDifference || left.createdAt.getTime() - right.createdAt.getTime();
    });
  const viewLabel =
    viewOptions.find((option) => option.value === view)?.label ?? "Active";
  const hasAppliedQueueFilters = category !== "all" || priority !== "all";
  const showQueueFilters = tasks.length > 0 || hasAppliedQueueFilters;
  const headerMeta = tasks.length
    ? `${tasks.length} ${viewLabel.toLowerCase()} ${tasks.length === 1 ? "task" : "tasks"}`
    : view === "active"
      ? "No outstanding tasks"
      : `No ${viewLabel.toLowerCase()} tasks`;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PracticePageHeader
        branding={result.branding}
        logoMeta={headerMeta}
        practiceName={result.practiceName}
        showLogo={false}
        size="compact"
        title="Tasks"
      >
        {result.locations.length > 1 ? (
          <PortalQuerySelect
            ariaLabel="Office"
            options={[
              { label: "All offices", value: "" },
              ...result.locations.map((item) => ({ label: item.label, value: item.id })),
            ]}
            param="office"
            value={result.selectedLocationId ?? ""}
          />
        ) : null}
      </PracticePageHeader>

      <section className="flex flex-col gap-3 border-y border-[var(--portal-border)] py-3 lg:flex-row lg:items-center lg:justify-between">
        <LinkSegmentedControl
          activeClassName="bg-[var(--portal-accent)] text-white hover:text-white"
          ariaLabel="Task status"
          className="w-full border border-[var(--portal-border)] bg-white sm:w-fit"
          inactiveClassName="text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]"
          itemClassName="flex-1 px-4 sm:min-w-24"
          items={viewOptions.map((option) => ({
            href: taskingHref({
              category: result.category,
              office: result.selectedLocationId,
              priority: result.priority,
              view: option.value,
            }),
            label: option.label,
            value: option.value,
          }))}
          value={view}
        />
        {showQueueFilters ? (
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <PortalQuerySelect
              ariaLabel="Category"
              options={[
                { label: "All categories", value: "" },
                ...portalTaskCategories.map((item) => ({
                  label: categoryLabels[item],
                  value: item,
                })),
              ]}
              param="category"
              value={result.category === "all" ? "" : result.category}
            />
            <PortalQuerySelect
              ariaLabel="Priority"
              options={[...priorityOptions]}
              param="priority"
              value={result.priority === "all" ? "" : result.priority}
            />
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-xl border border-[var(--portal-border)] bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-[var(--portal-border)] bg-[var(--portal-panel-soft)] px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-[var(--portal-ink)]">
            {viewLabel} queue
          </h2>
          {tasks.length ? (
            <span className="font-mono text-xs font-semibold tabular-nums text-[var(--portal-muted)]">
              {tasks.length}
            </span>
          ) : null}
        </header>
        {tasks.length ? (
          <div className="divide-y divide-[var(--portal-border)]">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <div className="px-5 py-14 text-center">
            {view === "active" ? (
              <span className="mx-auto mb-4 inline-flex size-10 items-center justify-center rounded-full bg-[var(--portal-live-soft)] text-[var(--portal-live)]">
                <Check className="size-5" aria-hidden="true" />
              </span>
            ) : null}
            <p className="text-sm font-semibold text-[var(--portal-ink)]">
              {view === "active"
                ? "You’re caught up"
                : `No ${viewLabel.toLowerCase()} tasks`}
            </p>
            <p className="mt-1 text-sm text-[var(--portal-muted)]">
              {view === "active"
                ? "There are no active staff follow-ups right now."
                : "Try another office or filter."}
            </p>
            {view === "active" ? (
              <Link
                className="mt-4 inline-flex text-sm font-medium text-[var(--portal-accent)]"
                href={taskingHref({
                  category: "all",
                  office: result.selectedLocationId,
                  priority: "all",
                  view: "completed",
                })}
              >
                Review completed tasks
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
