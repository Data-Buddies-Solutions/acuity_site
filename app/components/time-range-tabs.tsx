"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

const ranges = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
] as const;

export function TimeRangeTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const current = searchParams.get("range") || "24h";

  function selectRange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", value);
    params.delete("page");
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className={cn("w-full transition-opacity sm:w-auto", isPending && "opacity-50")}>
      <SegmentedControl
        aria-label="Time range"
        className="grid w-full grid-cols-4 sm:inline-flex sm:w-auto"
        itemClassName="px-2.5"
        items={ranges}
        onValueChange={selectRange}
        value={current}
      />
    </div>
  );
}
