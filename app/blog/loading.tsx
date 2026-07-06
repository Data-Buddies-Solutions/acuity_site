import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/app/components/ui/skeleton";

export default function BlogLoading() {
  return (
    <div className="py-16 md:py-24">
      <div className="mx-auto max-w-screen-xl space-y-12 px-4">
        <div className="mx-auto max-w-3xl space-y-4 text-center">
          <Badge variant="outline" className="text-sm font-medium uppercase">
            Automation insights
          </Badge>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-6 w-3/4 mx-auto" />
        </div>
        <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex flex-col space-y-4 rounded-2xl border border-border/40 p-6"
            >
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-10 w-full mt-4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
