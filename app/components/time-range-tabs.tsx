"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ranges = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7 Day" },
  { value: "30d", label: "30 Day" },
  { value: "all", label: "All Time" },
] as const;

export function TimeRangeTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const current = searchParams.get("range") || "24h";

  return (
    <div
      className={`w-full transition-opacity sm:w-auto ${isPending ? "opacity-50" : ""}`}
    >
      <Tabs
        value={current}
        onValueChange={(value) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("range", value);
          params.delete("page");
          startTransition(() => {
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          });
        }}
      >
        <TabsList className="h-9 w-full justify-start sm:w-auto">
          {ranges.map((r) => (
            <TabsTrigger key={r.value} value={r.value} className="px-3">
              {r.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
