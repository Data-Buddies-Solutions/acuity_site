import type { PortalTimeSavedBucket } from "@/lib/portal-overview";

const bucketLabels: Record<PortalTimeSavedBucket["key"], string> = {
  after_hours: "After-hours",
  faq: "Other calls",
  scheduling: "Scheduling",
};

function formatHoursMinutes(seconds: number) {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export default function StaffTimeSavedCard({
  buckets,
}: {
  buckets: PortalTimeSavedBucket[];
}) {
  const peak = Math.max(...buckets.map((bucket) => bucket.seconds), 1);

  return (
    <div className="flex h-full flex-col gap-6 p-5 lg:p-6">
      <h2 className="text-base font-semibold text-[var(--portal-ink)]">
        Call time breakdown
      </h2>

      <div className="space-y-4">
        {buckets.map((bucket) => {
          const width = `${Math.max(4, Math.round((bucket.seconds / peak) * 100))}%`;

          return (
            <div key={bucket.key}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-[var(--portal-ink)]">
                  {bucketLabels[bucket.key]}
                </p>
                <p className="font-mono text-sm font-semibold tabular-nums text-[var(--portal-ink)]">
                  {formatHoursMinutes(bucket.seconds)}
                </p>
              </div>
              <div className="mt-2 h-2 rounded-full bg-[var(--portal-panel)]">
                <div
                  className="h-full rounded-full bg-[var(--color-accent)]"
                  style={{ width }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
