"use server";

import { redirect } from "next/navigation";

import {
  approveInsuranceRuleRevision,
  rejectInsuranceRuleRevision,
} from "@/lib/insurance-rules";

export async function approveInsuranceRuleAction(formData: FormData) {
  const alertId = String(formData.get("alertId") || "");

  if (alertId) {
    await approveInsuranceRuleRevision(alertId);
  }

  redirect("/admin/insurance-rules");
}

export async function rejectInsuranceRuleAction(formData: FormData) {
  const alertId = String(formData.get("alertId") || "");
  const reviewNote = String(formData.get("reviewNote") || "");

  if (alertId) {
    await rejectInsuranceRuleRevision(alertId, reviewNote);
  }

  redirect("/admin/insurance-rules");
}
