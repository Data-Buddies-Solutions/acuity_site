"use server";

import { revalidatePath } from "next/cache";

import { AgentTaskStatus } from "@/generated/prisma/client";
import {
  canAccessPortalLocation,
  getCurrentPortalPracticeContext,
} from "@/lib/portal-access";
import { prisma } from "@/lib/prisma";

function parseStatus(value: FormDataEntryValue | null) {
  const status = String(value || "");
  if (status === "open") return AgentTaskStatus.OPEN;
  if (status === "in_progress") return AgentTaskStatus.IN_PROGRESS;
  if (status === "done") return AgentTaskStatus.DONE;
  if (status === "closed_no_action") return AgentTaskStatus.CLOSED_NO_ACTION;
  return null;
}

export async function updateAgentTaskStatus(formData: FormData) {
  const context = await getCurrentPortalPracticeContext();
  if (!context) return;

  const taskId = String(formData.get("taskId") || "").trim();
  const status = parseStatus(formData.get("status"));
  if (!taskId || !status) return;

  const task = await prisma.agentTask.findFirst({
    select: { id: true, locationId: true },
    where: {
      id: taskId,
      practiceId: context.practice.id,
    },
  });
  if (!task || !canAccessPortalLocation(context, task.locationId)) return;

  await prisma.agentTask.update({
    data: {
      completedAt:
        status === AgentTaskStatus.DONE || status === AgentTaskStatus.CLOSED_NO_ACTION
          ? new Date()
          : null,
      status,
    },
    where: { id: task.id },
  });

  revalidatePath("/portal/app/tasking");
}
