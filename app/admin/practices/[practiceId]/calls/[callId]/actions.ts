"use server";

import type { AgentCallEvaluationBucket } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { setAgentCallEvaluationBucket } from "@/lib/call-evaluations";
import { requireAdminSession } from "@/lib/admin-auth";

function parseBucket(value: FormDataEntryValue | null): AgentCallEvaluationBucket | null {
  if (value === "GOLDEN" || value === "BAD") {
    return value;
  }

  return null;
}

export async function setCallEvaluationBucketAction(formData: FormData) {
  const session = await requireAdminSession();
  const practiceId = String(formData.get("practiceId") || "");
  const callId = String(formData.get("callId") || "");
  const bucket = parseBucket(formData.get("bucket"));
  const detailPath = `/admin/practices/${practiceId}/calls/${callId}`;

  await setAgentCallEvaluationBucket({
    bucket,
    callId,
    createdByUserId: session.user.id,
    practiceId,
  });

  revalidatePath(`/admin/practices/${practiceId}`);
  revalidatePath(detailPath);
  redirect(detailPath);
}
