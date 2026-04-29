"use server";

import { redirect } from "next/navigation";

import { submitInsuranceRuleDraftForReview } from "@/lib/insurance-rules";

export async function saveInsuranceRuleDraftAction(formData: FormData) {
  const ruleSetId = String(formData.get("ruleSetId") || "");
  const rulesJson = String(formData.get("rulesJson") || "");

  if (!ruleSetId) {
    redirect("/portal/app/insurance-crosswalk");
  }

  const result = await submitInsuranceRuleDraftForReview({
    ruleSetId,
    rulesJson,
  });

  if (!result) {
    redirect("/portal/app/insurance-crosswalk");
  }

  const params = new URLSearchParams();

  if (result.slug) {
    params.set("rules", result.slug);
  }

  if ("invalid" in result && result.invalid) {
    params.set("mode", "edit");
    params.set("invalid", "1");
  } else {
    params.set(result.changed ? "submitted" : "unchanged", "1");
  }

  redirect(`/portal/app/insurance-crosswalk?${params.toString()}`);
}
