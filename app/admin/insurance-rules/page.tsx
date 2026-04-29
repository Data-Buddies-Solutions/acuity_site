import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";

import { InsuranceRulesView } from "@/app/components/InsuranceRulesView";
import { Button } from "@/app/components/ui/button";
import {
  getPendingInsuranceRuleReviews,
  normalizeInsuranceRulesForView,
} from "@/lib/insurance-rules";

import { approveInsuranceRuleAction, rejectInsuranceRuleAction } from "./actions";

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

export default async function AdminInsuranceRulesPage() {
  const reviews = await getPendingInsuranceRuleReviews();

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#748588]">
            Admin review
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
            Insurance Rules Updates
          </h1>
        </div>
        <div className="rounded-lg border border-black/6 bg-white px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#748588]">
            Pending
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#10272c]">
            {reviews.length}
          </p>
        </div>
      </section>

      {reviews.length === 0 ? (
        <section className="rounded-lg border border-black/6 bg-white px-5 py-10 text-center text-sm text-[#617477]">
          No insurance rule edits are waiting for review.
        </section>
      ) : (
        <section className="space-y-5">
          {reviews.map((review) => {
            const ruleSet = review.insuranceRuleSet;
            const revision = review.insuranceRuleRevision;
            const publishedRevision = ruleSet?.revisions[0] ?? null;

            if (!ruleSet || !revision) {
              return null;
            }

            const fallbackOfficeLabel =
              ruleSet.location?.name ??
              ruleSet.title.replace(/^Insurance Rules:\s*/i, "");
            const pendingRules = normalizeInsuranceRulesForView(
              revision.rules,
              fallbackOfficeLabel,
            );
            const publishedRules = publishedRevision
              ? normalizeInsuranceRulesForView(
                  publishedRevision.rules,
                  fallbackOfficeLabel,
                )
              : null;

            return (
              <article
                key={review.id}
                className="overflow-hidden rounded-lg border border-black/6 bg-white shadow-sm"
              >
                <header className="border-b border-black/6 px-5 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#748588]">
                        {review.practice.name}
                        {ruleSet.location?.name ? ` / ${ruleSet.location.name}` : ""}
                      </p>
                      <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#10272c]">
                        {ruleSet.title}
                      </h2>
                      <p className="mt-1 text-sm text-[#617477]">
                        Submitted {formatDate(revision.createdAt)}
                      </p>
                    </div>
                    <Link
                      href={`/admin/practices/${review.practice.id}`}
                      className="text-sm font-medium text-[#0d7377] hover:text-[#10272c]"
                    >
                      Practice detail
                    </Link>
                  </div>
                </header>

                <div className="grid gap-0 xl:grid-cols-2">
                  <section className="border-b border-black/6 px-5 py-5 xl:border-b-0 xl:border-r">
                    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#748588]">
                      Currently published
                    </p>
                    {publishedRules ? (
                      <InsuranceRulesView rules={publishedRules} />
                    ) : (
                      <p className="text-sm italic text-[#8a9a9d]">
                        No published version yet.
                      </p>
                    )}
                  </section>
                  <section className="px-5 py-5">
                    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#748588]">
                      Pending draft
                    </p>
                    <InsuranceRulesView rules={pendingRules} />
                  </section>
                </div>

                <footer className="border-t border-black/6 bg-[#fafbfb] px-5 py-4">
                  <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-end">
                    <form action={rejectInsuranceRuleAction} className="grid gap-2">
                      <input type="hidden" name="alertId" value={review.id} />
                      <label className="grid gap-1">
                        <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#748588]">
                          Rejection note
                        </span>
                        <input
                          className="h-10 rounded-lg border border-black/8 bg-white px-3 text-sm text-[#10272c] outline-none focus:border-[#0d7377]"
                          name="reviewNote"
                          placeholder="Optional note to retain in the revision history"
                        />
                      </label>
                      <Button type="submit" variant="secondary">
                        <XCircle className="h-4 w-4" aria-hidden="true" />
                        Reject
                      </Button>
                    </form>
                    <form action={approveInsuranceRuleAction}>
                      <input type="hidden" name="alertId" value={review.id} />
                      <Button type="submit" variant="primary">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        Approve and publish
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
