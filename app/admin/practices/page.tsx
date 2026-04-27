import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleDashed, PauseCircle } from "lucide-react";

import { Badge } from "@/app/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { getAdminPracticeSummaries } from "@/lib/admin-analytics";
import { formatAdminDateTime, formatCostMicros, formatPhone } from "@/lib/admin-format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type AgentStatus = "SETUP" | "ACTIVE" | "PAUSED" | "ERROR";

function agentStatusMeta(status: AgentStatus) {
  switch (status) {
    case "ACTIVE":
      return {
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
        icon: CheckCircle2,
        label: "Active",
      };
    case "ERROR":
      return {
        className: "border-red-200 bg-red-50 text-red-700",
        icon: AlertTriangle,
        label: "Error",
      };
    case "PAUSED":
      return {
        className: "border-amber-200 bg-amber-50 text-amber-700",
        icon: PauseCircle,
        label: "Paused",
      };
    case "SETUP":
      return {
        className: "border-slate-200 bg-white text-slate-600",
        icon: CircleDashed,
        label: "Setup",
      };
  }
}

function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const meta = agentStatusMeta(status);
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        meta.className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function StatTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-black/6 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#748588]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#10272c]">
        {value}
      </p>
    </div>
  );
}

export default async function AdminPracticesPage() {
  const practices = await getAdminPracticeSummaries();
  const liveCount = practices.filter((practice) => Boolean(practice.launchedAt)).length;
  const activeAgentCount = practices.filter((practice) => practice.agentStatus === "ACTIVE").length;
  const calls24h = practices.reduce((sum, practice) => sum + practice.calls24h, 0);
  const cost7dMicros = practices.reduce((sum, practice) => sum + practice.cost7dMicros, 0);
  const attentionCount = practices.reduce((sum, practice) => sum + practice.needsReviewCount, 0);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-[#6a7b7e]">
            Internal Admin
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
            Practice command center
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#617477]">
            The first operating view for agent health, call volume, cost, and review load by practice.
          </p>
        </div>
        <Badge variant="outline" className="w-fit border-[#0d7377]/25 bg-white text-[#0d7377]">
          {practices.length} practices
        </Badge>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Live Practices" value={`${liveCount}/${practices.length}`} />
        <StatTile label="Active Agents" value={`${activeAgentCount}`} />
        <StatTile label="Calls 24h" value={`${calls24h}`} />
        <StatTile label="Cost 7d" value={formatCostMicros(cost7dMicros)} />
        <StatTile label="Needs Review" value={`${attentionCount}`} />
      </section>

      <Card className="rounded-xl border-black/8 bg-white p-0">
        <CardHeader className="border-b border-black/6 px-5 py-4">
          <CardTitle className="text-lg">Practices</CardTitle>
          <CardDescription>
            Practice-level status is wired for the analytics data model. Empty rows mean call ingestion is not connected yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {practices.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-[#617477]">
              No practices have been created yet.
            </div>
          ) : (
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-black/6 bg-[#f8fbfa] text-xs uppercase tracking-[0.14em] text-[#748588]">
                <tr>
                  <th className="px-5 py-3 font-semibold">Practice</th>
                  <th className="px-5 py-3 font-semibold">Agent</th>
                  <th className="px-5 py-3 font-semibold">Phone</th>
                  <th className="px-5 py-3 font-semibold">Calls 24h</th>
                  <th className="px-5 py-3 font-semibold">Calls 7d</th>
                  <th className="px-5 py-3 font-semibold">Cost 7d</th>
                  <th className="px-5 py-3 font-semibold">Review</th>
                  <th className="px-5 py-3 font-semibold">Last Call</th>
                  <th className="px-5 py-3 font-semibold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-black/6">
                {practices.map((practice) => (
                  <tr key={practice.id} className="bg-white align-top hover:bg-[#f8fbfa]">
                    <td className="px-5 py-4">
                      <Link
                        href={`/admin/practices/${practice.id}`}
                        className="font-semibold text-[#10272c] hover:text-[#0d7377]"
                      >
                        {practice.name}
                      </Link>
                      <p className="mt-1 text-xs text-[#617477]">
                        {practice.launchedAt ? "Live" : practice.onboardingStatus.replace(/_/g, " ").toLowerCase()}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <AgentStatusBadge status={practice.agentStatus} />
                      <p className="mt-1 text-xs text-[#617477]">
                        {practice.agentCount} configured
                      </p>
                    </td>
                    <td className="px-5 py-4 text-[#10272c]">
                      {formatPhone(practice.phoneNumber)}
                    </td>
                    <td className="px-5 py-4 font-mono text-[#10272c]">{practice.calls24h}</td>
                    <td className="px-5 py-4 font-mono text-[#10272c]">{practice.calls7d}</td>
                    <td className="px-5 py-4 font-mono text-[#10272c]">
                      {formatCostMicros(practice.cost7dMicros)}
                    </td>
                    <td className="px-5 py-4">
                      {practice.needsReviewCount > 0 ? (
                        <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                          {practice.needsReviewCount} needs review
                        </span>
                      ) : (
                        <span className="text-[#748588]">Clear</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-[#10272c]">
                      {formatAdminDateTime(practice.lastCallAt)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/admin/practices/${practice.id}`}
                        className="inline-flex items-center gap-1 text-sm font-semibold text-[#0d7377] hover:text-[#0a5c5f]"
                      >
                        Open
                        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
