"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

const tabs = [
  { value: "overview", label: "Overview" },
  { value: "performance", label: "Performance" },
  { value: "costs", label: "Costs" },
  { value: "tokens", label: "Tokens" },
  { value: "tools", label: "Tools" },
] as const;

export function AnalyticsTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const current = searchParams.get("tab") || "overview";

  function selectTab(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", value);
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <div
      className={cn(
        "max-w-full overflow-x-auto pb-1 transition-opacity",
        isPending && "opacity-50",
      )}
    >
      <SegmentedControl
        aria-label="Analytics section"
        className="min-w-max"
        items={tabs}
        onValueChange={selectTab}
        value={current}
      />
    </div>
  );
}
