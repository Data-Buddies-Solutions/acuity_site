import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Clock3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MarkdownDocument } from "@/app/components/MarkdownDocument";
import { DocumentPanel } from "@/app/portal/app/DocumentView";
import { PortalDocumentSelector } from "@/app/portal/app/PortalDocumentSelector";
import { PortalCodeTextareaField } from "@/app/portal/app/PortalFields";
import { PracticePageHeader } from "@/app/portal/app/PracticePageHeader";
import { getPortalKnowledgeDocumentState } from "@/lib/knowledge-documents";
import { getPortalLocationDocumentLabel } from "@/lib/portal-document-label";
import { getPortalWorkspaceState } from "@/lib/portal-state";

import { saveKnowledgeDocumentDraftAction } from "./actions";

type SearchParamsInput =
  Promise<Record<string, string | string[] | undefined>> | undefined;

async function getPageParams(searchParams: SearchParamsInput) {
  const resolved = (await searchParams) || {};
  const rawMode = Array.isArray(resolved.mode) ? resolved.mode[0] : resolved.mode;
  const rawDoc = Array.isArray(resolved.doc) ? resolved.doc[0] : resolved.doc;
  const submitted = resolved.submitted === "1";
  const unchanged = resolved.unchanged === "1";

  return {
    editing: rawMode === "edit",
    selectedSlug: typeof rawDoc === "string" ? rawDoc : undefined,
    submitted,
    unchanged,
  };
}

function formatDate(date: Date | null) {
  if (!date) {
    return "Not published yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
    year: "numeric",
  }).format(date);
}

export default async function PortalKnowledgeBasePage({
  searchParams,
}: Readonly<{
  searchParams?: SearchParamsInput;
}>) {
  const portalState = await getPortalWorkspaceState();

  if (!portalState.launched) {
    redirect("/portal/app/onboarding?step=knowledgeBase");
  }

  const { editing, selectedSlug, submitted, unchanged } =
    await getPageParams(searchParams);
  const documentState = await getPortalKnowledgeDocumentState(selectedSlug);

  if (!documentState) {
    redirect("/portal");
  }

  const selectedDocument = documentState.selectedDocument;
  const practiceName = portalState.draft.practiceName || "Practice";

  if (!selectedDocument?.publishedRevision) {
    return (
      <div className="space-y-6">
        <PracticePageHeader
          branding={portalState.branding}
          practiceName={practiceName}
          title="Knowledge Base"
        />
        <DocumentPanel>
          <div className="px-5 py-10 text-sm text-[var(--portal-muted)] md:px-7">
            No knowledge base document has been created yet.
          </div>
        </DocumentPanel>
      </div>
    );
  }

  const editHref = `/portal/app/knowledge-base?doc=${encodeURIComponent(
    selectedDocument.slug,
  )}&mode=edit`;
  const viewHref = `/portal/app/knowledge-base?doc=${encodeURIComponent(
    selectedDocument.slug,
  )}`;
  const pendingRevision = selectedDocument.pendingRevision;
  const currentMarkdown =
    pendingRevision?.markdown ?? selectedDocument.publishedRevision.markdown;
  const selectorItems = documentState.documents.map((document) => ({
    id: document.id,
    label: getPortalLocationDocumentLabel({
      locationName: document.locationName,
      slug: document.slug,
      title: document.title,
      titlePrefix: "Knowledge Base",
    }),
    slug: document.slug,
  }));

  if (editing) {
    return (
      <div className="space-y-6">
        <PracticePageHeader
          branding={portalState.branding}
          practiceName={practiceName}
          title="Knowledge Base"
        >
          <Button asChild variant="secondary">
            <Link href={viewHref}>Back to document</Link>
          </Button>
        </PracticePageHeader>

        <PortalDocumentSelector
          ariaLabel="Knowledge base location"
          basePath="/portal/app/knowledge-base"
          items={selectorItems}
          queryKey="doc"
          selectedId={selectedDocument.id}
        />

        {pendingRevision ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This document already has a draft waiting for admin review. Saving again
            creates a newer pending draft.
          </div>
        ) : null}

        <form action={saveKnowledgeDocumentDraftAction} className="space-y-4">
          <input type="hidden" name="documentId" value={selectedDocument.id} />
          <PortalCodeTextareaField
            defaultValue={currentMarkdown}
            label="Markdown"
            name="markdown"
            required
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" variant="primary">
              Send for admin review
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button asChild variant="secondary">
              <Link href={viewHref}>Cancel</Link>
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PracticePageHeader
        branding={portalState.branding}
        practiceName={practiceName}
        title="Knowledge Base"
      >
        <Button asChild variant="secondary">
          <Link href={editHref}>Edit markdown</Link>
        </Button>
      </PracticePageHeader>

      <PortalDocumentSelector
        ariaLabel="Knowledge base location"
        basePath="/portal/app/knowledge-base"
        items={selectorItems}
        queryKey="doc"
        selectedId={selectedDocument.id}
      />

      {submitted ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Draft saved. Acuity admin will review it before publishing.
        </div>
      ) : null}

      {unchanged ? (
        <div className="rounded-lg border border-[var(--portal-border)] bg-white px-4 py-3 text-sm text-[var(--portal-muted)]">
          No changes were submitted.
        </div>
      ) : null}

      {pendingRevision ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Draft waiting for admin review</p>
            <p className="mt-1">
              The published document below is still live until Acuity admin approves the
              pending draft from {formatDate(pendingRevision.createdAt)}.
            </p>
          </div>
        </div>
      ) : null}

      <DocumentPanel>
        <div className="border-b border-[var(--portal-border)] px-5 py-4 text-xs font-medium uppercase tracking-[0.16em] text-[var(--portal-muted-soft)] md:px-7">
          Published {formatDate(selectedDocument.publishedRevision.publishedAt)}
        </div>
        <div className="px-5 py-6 md:px-7">
          <MarkdownDocument markdown={selectedDocument.publishedRevision.markdown} />
        </div>
      </DocumentPanel>
    </div>
  );
}
