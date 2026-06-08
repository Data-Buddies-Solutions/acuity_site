import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Clock3 } from "lucide-react";

import { Button } from "@/app/components/ui/button";
import { MarkdownDocument } from "@/app/components/MarkdownDocument";
import { DocumentPanel } from "@/app/portal/app/DocumentView";
import { PracticePageHeader } from "@/app/portal/app/PracticePageHeader";
import { getPortalKnowledgeDocumentState } from "@/lib/knowledge-documents";
import { getPortalWorkspaceState } from "@/lib/portal-state";
import { cn } from "@/lib/utils";

import { saveKnowledgeDocumentDraftAction } from "./actions";

type SearchParamsInput =
  | Promise<Record<string, string | string[] | undefined>>
  | undefined;

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

function documentLabel(document: {
  locationName: string | null;
  slug: string;
  title: string;
}) {
  if (document.locationName) {
    return document.locationName;
  }
  if (document.slug.includes("crystal")) {
    return "Crystal River";
  }
  if (document.slug.includes("spring")) {
    return "Spring Hill";
  }
  return document.title.replace(/^Knowledge Base:\s*/i, "");
}

function KnowledgeDocumentSelector({
  documents,
  selectedId,
}: {
  documents: Array<{
    id: string;
    locationName: string | null;
    slug: string;
    title: string;
  }>;
  selectedId: string;
}) {
  if (documents.length <= 1) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--portal-muted-soft)]">
        Location
      </p>
      <nav aria-label="Knowledge base location" className="flex gap-2 overflow-x-auto">
        {documents.map((document) => (
          <Link
            key={document.id}
            className={cn(
              "min-w-fit rounded-lg border px-3 py-2 text-sm font-medium transition",
              document.id === selectedId
                ? "border-[var(--portal-border)] bg-[var(--portal-accent-soft)] text-[var(--portal-accent)]"
                : "border-[var(--portal-border)] bg-white text-[var(--portal-muted)] hover:bg-[var(--portal-panel)] hover:text-[var(--portal-ink)]",
            )}
            href={`/portal/app/knowledge-base?doc=${encodeURIComponent(document.slug)}`}
          >
            {documentLabel(document)}
          </Link>
        ))}
      </nav>
    </section>
  );
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

        <KnowledgeDocumentSelector
          documents={documentState.documents}
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
          <label className="block space-y-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--portal-muted-soft)]">
              Markdown
            </span>
            <textarea
              className="min-h-[620px] w-full rounded-xl border border-[var(--portal-border)] bg-white px-4 py-3 font-mono text-sm leading-6 text-[var(--portal-ink)] outline-none transition placeholder:text-[var(--portal-muted-soft)] focus:border-[var(--portal-accent)] focus:ring-2 focus:ring-[var(--portal-accent)]/12"
              defaultValue={currentMarkdown}
              name="markdown"
              required
            />
          </label>
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

      <KnowledgeDocumentSelector
        documents={documentState.documents}
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
