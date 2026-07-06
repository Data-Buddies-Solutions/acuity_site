"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { PortalSelect } from "@/app/portal/app/PortalFields";
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
        <span className="pl-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--portal-muted-soft)]">
          Location
        </span>
      ) : null}
      <label className="inline-flex w-full sm:w-fit">
        <span className="sr-only">Location</span>
        <PortalSelect
          aria-label="Location"
          className="sm:min-w-56"
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
        </PortalSelect>
      </label>
    </div>
  );
}
