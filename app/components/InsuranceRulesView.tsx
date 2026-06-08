import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";

import type {
  InsuranceAliasRuleStatus,
  InsuranceRulesPayload,
} from "@/lib/insurance-rules";
import { cn } from "@/lib/utils";

function statusLabel(status: InsuranceAliasRuleStatus) {
  if (status === "accepted") {
    return "Accepted";
  }
  if (status === "needs_clarification") {
    return "Clarify";
  }
  return "Not accepted";
}

function StatusBadge({ status }: { status: InsuranceAliasRuleStatus }) {
  const Icon =
    status === "accepted"
      ? CheckCircle2
      : status === "needs_clarification"
        ? HelpCircle
        : XCircle;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold",
        status === "accepted" && "border-emerald-200 bg-emerald-50 text-emerald-800",
        status === "needs_clarification" && "border-amber-200 bg-amber-50 text-amber-800",
        status === "not_accepted" && "border-rose-200 bg-rose-50 text-rose-800",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}

function PlanList({
  empty,
  items,
  tone = "neutral",
}: {
  empty: string;
  items: string[];
  tone?: "neutral" | "danger";
}) {
  if (!items.length) {
    return <p className="text-sm italic text-[var(--portal-muted-soft)]">{empty}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className={cn(
            "rounded-lg border px-2.5 py-1 text-sm font-medium",
            tone === "danger"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-[var(--portal-border)] bg-[var(--portal-panel-soft)] text-[var(--portal-ink)]",
          )}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function InsuranceRulesView({ rules }: { rules: InsuranceRulesPayload }) {
  const clarificationRules = rules.aliasRules.filter(
    (rule) => rule.status === "needs_clarification",
  );

  return (
    <div className="space-y-6">
      {clarificationRules.length ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
              aria-hidden="true"
            />
            <div>
              <h3 className="text-sm font-semibold text-amber-900">
                Clarification rules
              </h3>
              <div className="mt-3 grid gap-2">
                {clarificationRules.map((rule) => (
                  <div
                    key={`${rule.aliases.join("|")}-${rule.clarificationNeeded || ""}`}
                    className="rounded-lg border border-amber-200 bg-white/70 px-3 py-2"
                  >
                    <p className="text-sm font-semibold text-[var(--portal-ink)]">
                      {rule.aliases.join(", ")}
                    </p>
                    <p className="mt-1 text-sm text-amber-900">
                      {rule.clarificationNeeded || "Clarify exact plan details."}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold tracking-normal text-[var(--portal-ink)]">
              Alias rules
            </h3>
            <p className="mt-1 text-sm text-[var(--portal-muted)]">
              {rules.aliasRules.length} caller phrases mapped for {rules.officeLabel}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-black/6">
          <table className="min-w-[920px] divide-y divide-black/6 text-left text-sm">
            <thead className="bg-[var(--portal-panel-soft)] text-xs font-semibold uppercase tracking-[0.14em] text-[var(--portal-muted-soft)]">
              <tr>
                <th className="px-4 py-3">Caller might say</th>
                <th className="px-4 py-3">Mapped plan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Proceed</th>
                <th className="px-4 py-3">Exact name</th>
                <th className="px-4 py-3">Clarification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/6 bg-white">
              {rules.aliasRules.map((rule) => (
                <tr key={`${rule.aliases.join("|")}-${rule.family || ""}`}>
                  <td className="px-4 py-3 align-top font-medium text-[var(--portal-ink)]">
                    {rule.aliases.join(", ")}
                  </td>
                  <td className="px-4 py-3 align-top text-[var(--portal-muted)]">
                    {rule.family || rule.callerPlan || "Not mapped"}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <StatusBadge status={rule.status} />
                  </td>
                  <td className="px-4 py-3 align-top text-[var(--portal-muted)]">
                    {rule.canProceed ? "Yes" : "No"}
                  </td>
                  <td className="px-4 py-3 align-top text-[var(--portal-muted)]">
                    {rule.needsExactPlanName ? "Yes" : "No"}
                  </td>
                  <td className="px-4 py-3 align-top text-[var(--portal-muted)]">
                    {rule.clarificationNeeded || "-"}
                  </td>
                </tr>
              ))}
              {!rules.aliasRules.length ? (
                <tr>
                  <td
                    className="px-4 py-5 text-sm italic text-[var(--portal-muted-soft)]"
                    colSpan={6}
                  >
                    No alias rules have been added.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.38fr)]">
        <div className="rounded-lg border border-black/6 bg-white px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold tracking-normal text-[var(--portal-ink)]">
              Accepted plans
            </h3>
            <span className="text-sm font-medium text-[var(--portal-muted)]">
              {rules.acceptedPlans.length}
            </span>
          </div>
          <PlanList items={rules.acceptedPlans} empty="No accepted plans listed." />
        </div>

        <div className="rounded-lg border border-rose-100 bg-white px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold tracking-normal text-[var(--portal-ink)]">
              Not accepted
            </h3>
            <span className="text-sm font-medium text-[var(--portal-muted)]">
              {rules.notAcceptedPlans.length}
            </span>
          </div>
          <PlanList
            items={rules.notAcceptedPlans}
            empty="No not-accepted plans listed."
            tone="danger"
          />
        </div>
      </section>
    </div>
  );
}
