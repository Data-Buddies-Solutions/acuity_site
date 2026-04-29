"use server";

import { redirect } from "next/navigation";

import { submitKnowledgeDocumentDraftForReview } from "@/lib/knowledge-documents";

export async function saveKnowledgeDocumentDraftAction(formData: FormData) {
  const documentId = String(formData.get("documentId") || "");
  const markdown = String(formData.get("markdown") || "");

  if (!documentId) {
    redirect("/portal/app/knowledge-base");
  }

  const result = await submitKnowledgeDocumentDraftForReview({
    documentId,
    markdown,
  });

  if (!result) {
    redirect("/portal/app/knowledge-base");
  }

  const params = new URLSearchParams({
    doc: result.slug,
  });

  params.set(result.changed ? "submitted" : "unchanged", "1");
  redirect(`/portal/app/knowledge-base?${params.toString()}`);
}
