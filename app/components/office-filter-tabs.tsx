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

  return (
    <div className={`transition-opacity ${isPending ? "opacity-50" : ""}`}>
      <Tabs
        value={current}
        onValueChange={(value) => {
          const params = new URLSearchParams(searchParams.toString());

          if (value === "all") {
            params.delete("office");
          } else {
            params.set("office", value);
          }

          const query = params.toString();

          startTransition(() => {
            router.replace(query ? `${pathname}?${query}` : pathname, {
              scroll: false,
            });
          });
        }}
      >
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="all">All Offices</TabsTrigger>
          {offices.map((office) => (
            <TabsTrigger key={office.id} value={office.id}>
              {office.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
