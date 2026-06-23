import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";

import { MarkdownDocument } from "@/app/components/MarkdownDocument";
import { Button } from "@/app/components/ui/button";
import { getPendingKnowledgeDocumentReviews } from "@/lib/knowledge-documents";

import { approveKnowledgeDocumentAction, rejectKnowledgeDocumentAction } from "./actions";

export const dynamic = "force-dynamic";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
    year: "numeric",
  }).format(date);
}

export default async function AdminKnowledgeBasePage() {
  const reviews = await getPendingKnowledgeDocumentReviews();

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--portal-muted-soft)]">
            Document queue
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-normal text-[var(--portal-ink)]">
            Knowledge Base Queue
          </h1>
        </div>
        <div className="rounded-xl border border-[var(--portal-border)] bg-white px-4 py-3 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--portal-muted-soft)]">
            Pending
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-normal text-[var(--portal-ink)]">
            {reviews.length}
          </p>
        </div>
      </section>

      {reviews.length === 0 ? (
        <section className="rounded-xl border border-[var(--portal-border)] bg-white px-5 py-10 text-center text-sm text-[var(--portal-muted)]">
          No knowledge base edits are waiting.
        </section>
      ) : (
        <section className="space-y-5">
          {reviews.map((review) => {
            const document = review.document;
            const revision = review.revision;
            const publishedRevision = document?.revisions[0] ?? null;

            if (!document || !revision) {
              return null;
            }

            return (
              <article
                key={review.id}
                className="overflow-hidden rounded-xl border border-[var(--portal-border)] bg-white shadow-sm"
              >
                <header className="border-b border-[var(--portal-border)] px-5 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--portal-muted-soft)]">
                        {review.practice.name}
                        {document.location?.name ? ` / ${document.location.name}` : ""}
                      </p>
                      <h2 className="mt-1 text-xl font-semibold tracking-normal text-[var(--portal-ink)]">
                        {document.title}
                      </h2>
                      <p className="mt-1 text-sm text-[var(--portal-muted)]">
                        Submitted {formatDate(revision.createdAt)}
                      </p>
                    </div>
                    <Link
                      href={`/admin/practices/${review.practice.id}`}
                      className="text-sm font-medium text-[var(--portal-accent)] hover:text-[var(--portal-ink)]"
                    >
                      Practice detail
                    </Link>
                  </div>
                </header>

                <div className="grid gap-0 lg:grid-cols-2">
                  <section className="border-b border-[var(--portal-border)] px-5 py-5 lg:border-b-0 lg:border-r">
                    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--portal-muted-soft)]">
                      Currently published
                    </p>
                    {publishedRevision ? (
                      <MarkdownDocument markdown={publishedRevision.markdown} />
                    ) : (
                      <p className="text-sm italic text-[var(--portal-muted-soft)]">
                        No published version yet.
                      </p>
                    )}
                  </section>
                  <section className="px-5 py-5">
                    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--portal-muted-soft)]">
                      Pending draft
                    </p>
                    <MarkdownDocument markdown={revision.markdown} />
                  </section>
                </div>

                <footer className="sticky bottom-0 z-10 border-t border-[var(--portal-border)] bg-white/95 px-5 py-4 shadow-[0_-8px_24px_rgba(16,24,40,0.06)] backdrop-blur lg:static lg:shadow-none">
                  <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-end">
                    <form action={rejectKnowledgeDocumentAction} className="grid gap-2">
                      <input type="hidden" name="alertId" value={review.id} />
                      <label className="grid gap-1">
                        <span className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--portal-muted-soft)]">
                          Return note
                        </span>
                        <input
                          className="h-10 rounded-lg border border-[var(--portal-border)] bg-white px-3 text-sm text-[var(--portal-ink)] outline-none transition focus:border-[var(--portal-accent)] focus:ring-2 focus:ring-[var(--portal-accent)]/15"
                          name="reviewNote"
                          placeholder="Optional note to retain in the revision history"
                        />
                      </label>
                      <Button
                        type="submit"
                        variant="secondary"
                        className="w-full lg:w-auto"
                      >
                        <XCircle className="h-4 w-4" aria-hidden="true" />
                        Return draft
                      </Button>
                    </form>
                    <form action={approveKnowledgeDocumentAction}>
                      <input type="hidden" name="alertId" value={review.id} />
                      <Button
                        type="submit"
                        variant="primary"
                        className="w-full lg:w-auto"
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        Publish update
                      </Button>
                    </form>
                  </div>
                </footer>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
