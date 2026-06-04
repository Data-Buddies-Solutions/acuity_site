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
    <div className="flex flex-col gap-4 rounded-xl border border-[#cfd5e2] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_rgba(16,24,40,0.04)] transition duration-150 hover:-translate-y-0.5 hover:border-[#b9c4dd] hover:shadow-[0_2px_4px_rgba(16,24,40,0.06),0_16px_34px_rgba(16,24,40,0.08)]">
      <div>
        <h3 className="text-base font-semibold tracking-normal text-[#151a24]">
          Front Desk Time Covered
        </h3>
        <p className="mt-3 text-4xl font-semibold tracking-normal text-[#151a24]">
          {formatHoursMinutes(totalSeconds)}
        </p>
        <p className="mt-2 text-sm text-[#7b8494]">
          Covered across handled patient calls
        </p>
      </div>

      <div className="space-y-3">
        {buckets.map((bucket) => {
          const ratio = bucket.seconds / peak;
          const width = `${Math.max(4, Math.round(ratio * 100))}%`;
          return (
            <div key={bucket.key}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-[#151a24]">{bucket.label}</p>
                <p className="text-sm font-semibold text-[#151a24]">
                  {formatHoursMinutes(bucket.seconds)}
                </p>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-[#edf0f5]">
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
