"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AdminPracticeOfficeFilterOption } from "@/lib/admin-analytics";

type OfficeFilterTabsProps = {
  offices: AdminPracticeOfficeFilterOption[];
  selectedOfficeId: string | null;
};

export function OfficeFilterTabs({ offices, selectedOfficeId }: OfficeFilterTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  if (offices.length <= 1) {
    return null;
  }

  const current = selectedOfficeId ?? "all";
  const items = [{ id: "all", label: "All Offices" }, ...offices];

  return (
    <div
      className={`max-w-full overflow-x-auto pb-1 transition-opacity ${
        isPending ? "opacity-50" : ""
      }`}
    >
      <Tabs
        value={current}
        onValueChange={(value) => {
          const params = new URLSearchParams(searchParams.toString());

          if (value === "all") {
            params.delete("office");
          } else {
            params.set("office", value);
          }
          params.delete("page");

          const query = params.toString();

          startTransition(() => {
            router.replace(query ? `${pathname}?${query}` : pathname, {
              scroll: false,
            });
          });
        }}
      >
        <TabsList className="h-9 w-full min-w-max justify-start">
          {items.map((item) => (
            <TabsTrigger key={item.id} value={item.id} className="min-w-fit px-3">
              <span className="max-w-40 truncate">{item.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
