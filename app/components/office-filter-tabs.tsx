"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { NativeSelect } from "@/components/ui/native-select";
import type { AdminPracticeOfficeFilterOption } from "@/lib/admin-analytics";
import { cn } from "@/lib/utils";

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

  function selectOffice(value: string) {
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
  }

  return (
    <div className={cn("w-full min-w-0 transition-opacity", isPending && "opacity-50")}>
      <label className="sr-only" htmlFor="admin-office-filter">
        Office
      </label>
      <NativeSelect
        aria-label="Office"
        className="w-full lg:min-w-52"
        id="admin-office-filter"
        value={current}
        onChange={(event) => selectOffice(event.target.value)}
      >
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
