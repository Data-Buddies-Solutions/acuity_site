"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const tabs = [
  { value: "overview", label: "Overview" },
  { value: "quality", label: "Quality" },
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

  return (
    <div className={`transition-opacity ${isPending ? "opacity-50" : ""}`}>
      <Tabs
        value={current}
        onValueChange={(value) => {
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
        }}
      >
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
