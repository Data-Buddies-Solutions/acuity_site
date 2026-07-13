import { Skeleton } from "@/components/ui/skeleton";

export default function PortalPageLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading page"
      className="mx-auto max-w-6xl space-y-5"
      role="status"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-8 w-44" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-48" />
        </div>
      </div>

      <div className="grid gap-px overflow-hidden rounded-xl border border-[var(--portal-border)] bg-[var(--portal-border)] sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div className="space-y-3 bg-white p-5" key={item}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-2 w-full" />
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <div className="rounded-xl border border-[var(--portal-border)] bg-white p-5">
          <div className="mb-8 flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-24" />
          </div>
          <Skeleton className="h-52 w-full" />
        </div>
        <div className="space-y-5 rounded-xl border border-[var(--portal-border)] bg-white p-5">
          <Skeleton className="h-4 w-36" />
          {[0, 1, 2].map((item) => (
            <div className="space-y-2" key={item}>
              <div className="flex justify-between gap-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-10" />
              </div>
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading portal content</span>
    </div>
  );
}
