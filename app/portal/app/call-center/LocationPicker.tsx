"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronDown } from "lucide-react";

import type { PortalCallCenterLocation } from "@/lib/call-center";

export default function LocationPicker({
  basePath = "/portal/app/call-center",
  currentId,
  locations,
  showLabel = true,
}: {
  basePath?: string;
  currentId: string;
  locations: ReadonlyArray<PortalCallCenterLocation>;
  showLabel?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1.5">
      {showLabel ? (
        <span className="pl-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8a999b]">
          Location
        </span>
      ) : null}
      <label className="relative inline-flex w-full items-center sm:w-fit">
        <span className="sr-only">Location</span>
        <select
          aria-label="Location"
          className="h-10 w-full appearance-none rounded-lg border border-black/8 bg-white pl-4 pr-10 text-sm font-medium text-[#10272c] shadow-sm outline-none transition focus:border-[#0d7377] sm:min-w-56"
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value;
            startTransition(() => {
              router.push(`${basePath}?office=${encodeURIComponent(next)}`);
            });
          }}
          value={currentId}
        >
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 h-4 w-4 text-[#617477]"
        />
      </label>
    </div>
  );
}
