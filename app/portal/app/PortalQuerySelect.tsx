"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PortalSelect } from "@/app/portal/app/PortalFields";
import { cn } from "@/lib/utils";

type QuerySelectOption = {
  label: string;
  value: string;
};

export function PortalQuerySelect({
  ariaLabel,
  className,
  options,
  param,
  value,
}: {
  ariaLabel: string;
  className?: string;
  options: QuerySelectOption[];
  param: string;
  value: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <label className="block min-w-0">
      <span className="sr-only">{ariaLabel}</span>
      <PortalSelect
        aria-label={ariaLabel}
        className={cn(
          "h-10 min-w-44 rounded-lg border-[var(--portal-border)]",
          className,
        )}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (nextValue === value) return;

          const params = new URLSearchParams(searchParams.toString());
          if (nextValue) {
            params.set(param, nextValue);
          } else {
            params.delete(param);
          }
          params.delete("page");

          const query = params.toString();
          router.push(`${pathname}${query ? `?${query}` : ""}`);
        }}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value || "all"} value={option.value}>
            {option.label}
          </option>
        ))}
      </PortalSelect>
    </label>
  );
}
