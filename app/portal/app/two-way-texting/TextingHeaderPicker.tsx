"use client";

import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

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
    <label className="relative block w-full min-w-fit sm:w-auto">
      <span className="sr-only">Texting location</span>
      <select
        className="h-12 w-full min-w-64 appearance-none rounded-xl border border-[var(--portal-border-strong)] bg-white px-3 pr-10 text-sm font-semibold text-[var(--portal-ink)] shadow-sm outline-none transition focus:border-[#536a91] focus:ring-2 focus:ring-[#536a91]/15"
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
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--portal-muted-soft)]"
        aria-hidden="true"
      />
    </label>
  );
}
