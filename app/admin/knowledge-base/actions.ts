"use server";

import { redirect } from "next/navigation";

import {
  approveKnowledgeDocumentRevision,
  rejectKnowledgeDocumentRevision,
} from "@/lib/knowledge-documents";

export async function approveKnowledgeDocumentAction(formData: FormData) {
  const alertId = String(formData.get("alertId") || "");

  if (alertId) {
    await approveKnowledgeDocumentRevision(alertId);
  }

  redirect("/admin/knowledge-base");
}

export async function rejectKnowledgeDocumentAction(formData: FormData) {
  const alertId = String(formData.get("alertId") || "");
  const reviewNote = String(formData.get("reviewNote") || "");

  if (alertId) {
    await rejectKnowledgeDocumentRevision(alertId, reviewNote);
  }

  redirect("/admin/knowledge-base");
}
