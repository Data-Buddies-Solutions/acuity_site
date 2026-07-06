"use client";

import { useRouter } from "next/navigation";

import { PortalSelect } from "@/app/portal/app/PortalFields";

type InboxOption = {
  id: string;
  label: string;
  phoneNumber: string;
};

export default function TextingHeaderPicker({
  options,
  selectedId,
}: {
  options: InboxOption[];
  selectedId: string;
}) {
  const router = useRouter();

  return (
    <label className="block w-full min-w-fit sm:w-auto">
      <span className="sr-only">Texting location</span>
      <PortalSelect
        className="h-12 min-w-64 rounded-xl border-[var(--portal-border-strong)] px-3 font-semibold"
        wrapperClassName="block"
        onChange={(event) => {
          if (event.target.value === selectedId) {
            return;
          }

          router.push(
            `/portal/app/two-way-texting?inbox=${encodeURIComponent(event.target.value)}`,
          );
        }}
        value={selectedId}
      >
        {options.length ? (
          options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))
        ) : (
          <option value="">Texting</option>
        )}
      </PortalSelect>
    </label>
  );
}
