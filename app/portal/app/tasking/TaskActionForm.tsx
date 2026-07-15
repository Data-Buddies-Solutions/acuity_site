import { RotateCcw, X } from "lucide-react";

import { updateAgentTaskStatus } from "@/app/portal/app/tasking/actions";
import { Button } from "@/components/ui/button";
import type { PortalTask } from "@/lib/portal-tasks";

export function TaskActionForm({ task }: { task: PortalTask }) {
  const isActive = task.status === "open" || task.status === "in_progress";

  if (!isActive) {
    return (
      <form action={updateAgentTaskStatus}>
        <input name="taskId" type="hidden" value={task.id} />
        <Button name="status" size="sm" type="submit" value="open" variant="outline">
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
        type="submit"
        value="closed_no_action"
        variant="ghost"
      >
        <X />
      </Button>
      <Button name="status" size="sm" type="submit" value="done" variant="primary">
        Completed
      </Button>
    </form>
  );
}
