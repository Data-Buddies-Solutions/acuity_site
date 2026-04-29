import type { PortalTimeSavedBucket } from "@/lib/portal-overview";

function formatHoursMinutes(seconds: number) {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export default function StaffTimeSavedCard({
  buckets,
  totalSeconds,
}: {
  buckets: PortalTimeSavedBucket[];
  totalSeconds: number;
}) {
  const peak = Math.max(...buckets.map((bucket) => bucket.seconds), 1);

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-black/6 bg-white p-5 shadow-sm">
      <div>
        <h3 className="text-base font-semibold tracking-[-0.02em] text-[#10272c]">
          Staff Time Saved
        </h3>
        <p className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-[#10272c]">
          {formatHoursMinutes(totalSeconds)}
        </p>
        <p className="mt-1 text-sm text-[#617477]">Protected across all locations</p>
      </div>

      <div className="space-y-4">
        {buckets.map((bucket) => {
          const ratio = bucket.seconds / peak;
          const width = `${Math.max(4, Math.round(ratio * 100))}%`;
          return (
            <div key={bucket.key}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-[#10272c]">{bucket.label}</p>
                <p className="text-sm font-semibold text-[#10272c]">
                  {formatHoursMinutes(bucket.seconds)}
                </p>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-[#eef2f2]">
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
