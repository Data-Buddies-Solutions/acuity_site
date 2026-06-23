import Link from "next/link";

import { getAdminPracticeSummaries } from "@/lib/admin-analytics";
import { formatAdminDateTime, formatCostMicros, formatPhone } from "@/lib/admin-format";

export const dynamic = "force-dynamic";

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--portal-border)] bg-white px-3 py-3 shadow-sm sm:px-4">
      <p className="text-[10px] font-medium uppercase text-[var(--portal-muted-soft)]">
        {label}
      </p>
      <p className="mt-1 truncate text-xl font-semibold tracking-normal text-[var(--portal-ink)] sm:text-2xl">
        {value}
      </p>
    </div>
  );
}

type AdminPracticeSummary = Awaited<ReturnType<typeof getAdminPracticeSummaries>>[number];

function statusLabel(practice: AdminPracticeSummary) {
  if (!practice.launchedAt) return "Setup";
  return practice.agentStatus === "ACTIVE" ? "Active" : practice.agentStatus;
}

function PracticeCard({ practice }: { practice: AdminPracticeSummary }) {
  return (
    <article className="space-y-3 rounded-xl border border-[var(--portal-border)] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/admin/practices/${practice.id}`}
            className="block truncate text-base font-semibold text-[var(--portal-ink)] hover:text-[var(--portal-accent)]"
          >
            {practice.name}
          </Link>
          <p className="mt-1 truncate text-sm text-[var(--portal-muted)]">
            {formatPhone(practice.phoneNumber)}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--portal-border)] bg-[var(--portal-accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--portal-accent)]">
          {statusLabel(practice)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-[var(--portal-panel-soft)] px-2.5 py-2">
          <p className="text-[10px] font-medium uppercase text-[var(--portal-muted-soft)]">
            24h
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-[var(--portal-ink)]">
            {practice.calls24h}
          </p>
        </div>
        <div className="rounded-lg bg-[var(--portal-panel-soft)] px-2.5 py-2">
          <p className="text-[10px] font-medium uppercase text-[var(--portal-muted-soft)]">
            7d
          </p>
          <p className="mt-1 font-mono text-sm font-semibold text-[var(--portal-ink)]">
            {practice.calls7d}
          </p>
        </div>
        <div className="rounded-lg bg-[var(--portal-panel-soft)] px-2.5 py-2">
          <p className="text-[10px] font-medium uppercase text-[var(--portal-muted-soft)]">
            Cost
          </p>
          <p className="mt-1 truncate font-mono text-sm font-semibold text-[var(--portal-ink)]">
            {formatCostMicros(practice.cost7dMicros)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--portal-muted)]">
        <span>
          {practice.agentCount} agent{practice.agentCount === 1 ? "" : "s"}
        </span>
        <span>{formatAdminDateTime(practice.lastCallAt)}</span>
      </div>
    </article>
  );
}

export default async function AdminPracticesPage() {
  const practices = await getAdminPracticeSummaries();
  const liveCount = practices.filter((practice) => Boolean(practice.launchedAt)).length;
  const activeAgentCount = practices.filter(
    (practice) => practice.agentStatus === "ACTIVE",
  ).length;
  const calls24h = practices.reduce((sum, practice) => sum + practice.calls24h, 0);
  const cost7dMicros = practices.reduce(
    (sum, practice) => sum + practice.cost7dMicros,
    0,
  );

  return (
    <div className="max-w-full space-y-4 md:space-y-6">
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-normal text-[var(--portal-ink)] sm:text-3xl">
            Command Center
          </h1>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatTile label="Live Practices" value={`${liveCount}/${practices.length}`} />
        <StatTile label="Active Agents" value={`${activeAgentCount}`} />
        <StatTile label="Calls 24h" value={`${calls24h}`} />
        <StatTile label="Cost 7d" value={formatCostMicros(cost7dMicros)} />
      </section>

      <section>
        {practices.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[var(--portal-muted)]">
            No practices have been created yet.
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:hidden">
              {practices.map((practice) => (
                <PracticeCard key={practice.id} practice={practice} />
              ))}
            </div>

            <div className="hidden overflow-x-auto rounded-xl border border-[var(--portal-border)] bg-white md:block">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-[var(--portal-border)] bg-[var(--portal-panel-soft)] text-xs uppercase text-[var(--portal-muted-soft)]">
                  <tr>
                    <th className="py-3 pl-4 pr-5 font-semibold">Practice</th>
                    <th className="px-5 py-3 font-semibold">Calls 24h</th>
                    <th className="px-5 py-3 font-semibold">Calls 7d</th>
                    <th className="px-5 py-3 font-semibold">Cost 7d</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--portal-border)]">
                  {practices.map((practice) => (
                    <tr
                      key={practice.id}
                      className="align-top hover:bg-[var(--portal-panel-soft)]"
                    >
                      <td className="py-4 pl-4 pr-5">
                        <Link
                          href={`/admin/practices/${practice.id}`}
                          className="font-semibold text-[var(--portal-ink)] hover:text-[var(--portal-accent)]"
                        >
                          {practice.name}
                        </Link>
                      </td>
                      <td className="px-5 py-4 font-mono text-[var(--portal-ink)]">
                        {practice.calls24h}
                      </td>
                      <td className="px-5 py-4 font-mono text-[var(--portal-ink)]">
                        {practice.calls7d}
                      </td>
                      <td className="px-5 py-4 font-mono text-[var(--portal-ink)]">
                        {formatCostMicros(practice.cost7dMicros)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
