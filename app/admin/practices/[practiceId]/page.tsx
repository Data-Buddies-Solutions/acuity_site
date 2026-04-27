import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  DollarSign,
  PhoneCall,
  Timer,
} from "lucide-react";

import { Badge } from "@/app/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { getAdminPracticeDetail } from "@/lib/admin-analytics";
import {
  formatAdminDateTime,
  formatCostMicros,
  formatDuration,
  formatPercent,
  formatPhone,
  formatShortDate,
} from "@/lib/admin-format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type AgentStatus = "SETUP" | "ACTIVE" | "PAUSED" | "ERROR";

function statusClass(status: AgentStatus) {
  switch (status) {
    case "ACTIVE":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "ERROR":
      return "border-red-200 bg-red-50 text-red-700";
    case "PAUSED":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "SETUP":
      return "border-slate-200 bg-white text-slate-600";
  }
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const Icon = status === "ACTIVE" ? CheckCircle2 : status === "ERROR" ? AlertTriangle : CircleDashed;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        statusClass(status),
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

function KpiCard({
  icon: Icon,
  label,
  sub,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub?: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-black/6 bg-white px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#748588]">
          {label}
        </p>
        <Icon className="h-4 w-4 text-[#0d7377]" aria-hidden="true" />
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-[#617477]">{sub}</p> : null}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-black/12 bg-[#f8fbfa] px-4 py-8 text-center text-sm text-[#617477]">
      {children}
    </div>
  );
}

function costCategoryLabel(category: string) {
  return category
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default async function AdminPracticeDetailPage({
  params,
}: {
  params: Promise<{ practiceId: string }>;
}) {
  const { practiceId } = await params;
  const detail = await getAdminPracticeDetail(practiceId);

  if (!detail) {
    notFound();
  }

  const { agentStatus, costByCategory, dailyBuckets7d, practice, recentCalls, stats } = detail;

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <Link
          href="/admin/practices"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#0d7377] hover:text-[#0a5c5f]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Practices
        </Link>

        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#6a7b7e]">
              Practice Detail
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
              {practice.name}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#617477]">
              {practice.launchedAt
                ? `Live since ${formatAdminDateTime(practice.launchedAt)}`
                : `Current onboarding status: ${practice.onboardingStatus.replace(/_/g, " ").toLowerCase()}`}
            </p>
          </div>
          <StatusBadge status={agentStatus} />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          icon={PhoneCall}
          label="Calls 7d"
          sub={`${stats.calls24h} in the last 24h`}
          value={`${stats.calls7d}`}
        />
        <KpiCard
          icon={DollarSign}
          label="Cost 7d"
          sub={`${formatCostMicros(stats.cost30dMicros)} in 30d`}
          value={formatCostMicros(stats.cost7dMicros)}
        />
        <KpiCard
          icon={Timer}
          label="Avg Call"
          sub={`${stats.calls30d} calls in 30d`}
          value={formatDuration(stats.avgDurationSec)}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Actions"
          sub="Booked, confirmed, or cancelled"
          value={`${stats.appointments}`}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Needs Review"
          sub={`${formatPercent(Math.round(stats.transferRate7d * stats.calls7d), stats.calls7d)} transfer rate`}
          value={`${stats.needsReview30d}`}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-xl border-black/8 bg-white">
          <CardHeader>
            <CardTitle className="text-lg">7-day call volume</CardTitle>
            <CardDescription>Daily counts and estimated internal call cost.</CardDescription>
          </CardHeader>
          <CardContent>
            {dailyBuckets7d.some((bucket) => bucket.calls > 0) ? (
              <div className="space-y-3">
                {dailyBuckets7d.map((bucket) => {
                  const maxCalls = Math.max(...dailyBuckets7d.map((item) => item.calls), 1);
                  const width = `${Math.max((bucket.calls / maxCalls) * 100, bucket.calls > 0 ? 8 : 0)}%`;

                  return (
                    <div key={bucket.date.toISOString()} className="grid gap-2 sm:grid-cols-[88px_minmax(0,1fr)_84px] sm:items-center">
                      <p className="text-xs font-semibold text-[#617477]">{formatShortDate(bucket.date)}</p>
                      <div className="h-2.5 overflow-hidden rounded-full bg-[#eef5f3]">
                        <div className="h-full rounded-full bg-[#0d7377]" style={{ width }} />
                      </div>
                      <p className="text-right font-mono text-xs text-[#10272c]">
                        {bucket.calls} / {formatCostMicros(bucket.costMicros)}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState>No call activity has been ingested for the last 7 days.</EmptyState>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl border-black/8 bg-white">
          <CardHeader>
            <CardTitle className="text-lg">Agent setup</CardTitle>
            <CardDescription>Configured agents and phone-number mappings for this practice.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#748588]">
                Agents
              </p>
              <div className="mt-2 space-y-2">
                {practice.agents.length > 0 ? (
                  practice.agents.map((agent) => (
                    <div key={agent.id} className="rounded-lg border border-black/6 bg-[#f8fbfa] px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-[#10272c]">{agent.name}</p>
                        <StatusBadge status={agent.status} />
                      </div>
                      <p className="mt-1 text-xs text-[#617477]">
                        {[agent.llmModel, agent.voiceProvider, agent.voiceName].filter(Boolean).join(" / ") ||
                          "No model or voice metadata yet"}
                      </p>
                    </div>
                  ))
                ) : (
                  <EmptyState>No agent has been configured yet.</EmptyState>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#748588]">
                Phone Numbers
              </p>
              <div className="mt-2 space-y-2">
                {practice.phoneNumbers.length > 0 ? (
                  practice.phoneNumbers.map((phone) => (
                    <div key={phone.id} className="flex items-center justify-between gap-3 rounded-lg border border-black/6 bg-white px-3 py-3">
                      <div>
                        <p className="font-mono text-sm text-[#10272c]">{formatPhone(phone.phoneNumber)}</p>
                        <p className="text-xs text-[#617477]">
                          {phone.location?.name || phone.label || "Practice-level number"}
                        </p>
                      </div>
                      {phone.isPrimary ? <Badge variant="outline">Primary</Badge> : null}
                    </div>
                  ))
                ) : (
                  <EmptyState>No phone mapping exists yet.</EmptyState>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="rounded-xl border-black/8 bg-white">
          <CardHeader>
            <CardTitle className="text-lg">30-day cost breakdown</CardTitle>
            <CardDescription>Exact line items appear here once provider cost ingestion is connected.</CardDescription>
          </CardHeader>
          <CardContent>
            {costByCategory.length > 0 ? (
              <div className="space-y-2">
                {costByCategory.map((item) => (
                  <div key={item.category} className="flex items-center justify-between gap-3 rounded-lg border border-black/6 px-3 py-3">
                    <p className="text-sm font-semibold text-[#10272c]">{costCategoryLabel(item.category)}</p>
                    <p className="font-mono text-sm text-[#10272c]">{formatCostMicros(item.costMicros)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState>
                No cost line items yet. The KPI cards above use per-call estimated cost while exact provider costs are wired in.
              </EmptyState>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl border-black/8 bg-white p-0">
          <CardHeader className="border-b border-black/6 px-5 py-4">
            <CardTitle className="text-lg">Recent calls</CardTitle>
            <CardDescription>Last 20 calls ingested for this practice.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {recentCalls.length > 0 ? (
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead className="border-b border-black/6 bg-[#f8fbfa] text-xs uppercase tracking-[0.14em] text-[#748588]">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Started</th>
                    <th className="px-5 py-3 font-semibold">Caller</th>
                    <th className="px-5 py-3 font-semibold">Duration</th>
                    <th className="px-5 py-3 font-semibold">Outcome</th>
                    <th className="px-5 py-3 font-semibold">Cost</th>
                    <th className="px-5 py-3 font-semibold">Review</th>
                    <th className="px-5 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/6">
                  {recentCalls.map((call) => {
                    const actions = [
                      call.bookedAppointment ? "Booked" : null,
                      call.confirmedAppointment ? "Confirmed" : null,
                      call.cancelledAppointment ? "Cancelled" : null,
                      call.transferred ? "Transferred" : null,
                    ].filter(Boolean);

                    return (
                      <tr key={call.id} className="align-top hover:bg-[#f8fbfa]">
                        <td className="px-5 py-4 text-[#10272c]">
                          {formatAdminDateTime(call.startedAt)}
                        </td>
                        <td className="px-5 py-4 font-mono text-[#10272c]">
                          {formatPhone(call.callerPhone)}
                        </td>
                        <td className="px-5 py-4 font-mono text-[#10272c]">
                          {formatDuration(call.durationSec)}
                        </td>
                        <td className="px-5 py-4">
                          {actions.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {actions.map((action) => (
                                <span key={action} className="rounded-full bg-[#e8f4f4] px-2 py-1 text-xs font-semibold text-[#0d7377]">
                                  {action}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[#748588]">{call.status.toLowerCase()}</span>
                          )}
                        </td>
                        <td className="px-5 py-4 font-mono text-[#10272c]">
                          {formatCostMicros(call.estimatedCostMicros)}
                        </td>
                        <td className="px-5 py-4">
                          {call.needsReview ? (
                            <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                              Needs review
                            </span>
                          ) : (
                            <span className="text-[#748588]">{call.reviewStatus || "Clear"}</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <Link
                            href={`/admin/practices/${practice.id}/calls/${call.id}`}
                            className="inline-flex items-center gap-1 text-sm font-semibold text-[#0d7377] hover:text-[#0a5c5f]"
                          >
                            Detail
                            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="p-5">
                <EmptyState>No calls have been ingested for this practice in the last 30 days.</EmptyState>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
