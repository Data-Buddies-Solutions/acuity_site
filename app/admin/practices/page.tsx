import Link from "next/link";

import { getAdminPracticeSummaries } from "@/lib/admin-analytics";
import { formatCostMicros } from "@/lib/admin-format";

export const dynamic = "force-dynamic";

function StatTile({ label, value }: { label: string; value: string }) {
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
  const activeAgentCount = practices.filter(
    (practice) => practice.agentStatus === "ACTIVE",
  ).length;
  const calls24h = practices.reduce((sum, practice) => sum + practice.calls24h, 0);
  const cost7dMicros = practices.reduce(
    (sum, practice) => sum + practice.cost7dMicros,
    0,
  );
  const attentionCount = practices.reduce(
    (sum, practice) => sum + practice.needsReviewCount,
    0,
  );

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-[#10272c]">
            Command Center
          </h1>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Live Practices" value={`${liveCount}/${practices.length}`} />
        <StatTile label="Active Agents" value={`${activeAgentCount}`} />
        <StatTile label="Calls 24h" value={`${calls24h}`} />
        <StatTile label="Cost 7d" value={formatCostMicros(cost7dMicros)} />
        <StatTile label="Needs Review" value={`${attentionCount}`} />
      </section>

      <section className="overflow-x-auto">
        {practices.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[#617477]">
            No practices have been created yet.
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-black/8 text-xs uppercase tracking-[0.14em] text-[#748588]">
              <tr>
                <th className="py-3 pr-5 font-semibold">Practice</th>
                <th className="px-5 py-3 font-semibold">Calls 24h</th>
                <th className="px-5 py-3 font-semibold">Calls 7d</th>
                <th className="px-5 py-3 font-semibold">Cost 7d</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/6">
              {practices.map((practice) => (
                <tr key={practice.id} className="align-top hover:bg-white/70">
                  <td className="py-4 pr-5">
                    <Link
                      href={`/admin/practices/${practice.id}`}
                      className="font-semibold text-[#10272c] hover:text-[#0d7377]"
                    >
                      {practice.name}
                    </Link>
                  </td>
                  <td className="px-5 py-4 font-mono text-[#10272c]">
                    {practice.calls24h}
                  </td>
                  <td className="px-5 py-4 font-mono text-[#10272c]">
                    {practice.calls7d}
                  </td>
                  <td className="px-5 py-4 font-mono text-[#10272c]">
                    {formatCostMicros(practice.cost7dMicros)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
