"use client";

import { useRouter } from "next/navigation";

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
    <label className="relative min-w-fit">
      <span className="sr-only">Texting location</span>
      <select
        className="h-10 min-w-52 appearance-none rounded-lg border border-black/8 bg-white px-3 pr-8 text-sm font-medium text-[#10272c] shadow-sm outline-none transition focus:border-[#0d7377]"
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
    </label>
  );
}
