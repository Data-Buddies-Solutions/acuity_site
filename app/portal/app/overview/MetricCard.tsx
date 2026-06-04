import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

type Direction = "up" | "down" | "flat";

const deltaStyles: Record<Direction, string> = {
  down: "text-rose-600",
  flat: "text-[#617477]",
  up: "text-emerald-600",
};

const deltaIcons: Record<Direction, typeof ArrowUpRight> = {
  down: ArrowDownRight,
  flat: Minus,
  up: ArrowUpRight,
};

export default function MetricCard({
  delta,
  label,
  note,
  value,
}: {
  delta?: { direction: Direction; label: string } | null;
  label: string;
  note?: string;
  value: string;
}) {
  const DeltaIcon = delta ? deltaIcons[delta.direction] : null;

  return (
    <div className="rounded-xl border border-[#cfd5e2] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_rgba(16,24,40,0.04)] transition duration-150 hover:-translate-y-0.5 hover:border-[#b9c4dd] hover:shadow-[0_2px_4px_rgba(16,24,40,0.06),0_16px_34px_rgba(16,24,40,0.08)]">
      <p className="text-sm font-medium leading-5 tracking-normal text-[#8a94a6]">
        {label}
      </p>
      <p className="mt-3 text-4xl font-semibold tracking-normal text-[#151a24]">
        {value}
      </p>
      {delta && DeltaIcon ? (
        <p
          className={cn(
            "mt-3 inline-flex items-center gap-1 text-sm font-medium",
            deltaStyles[delta.direction],
          )}
        >
          <DeltaIcon className="h-4 w-4" aria-hidden="true" />
          {delta.label}
        </p>
      ) : note ? (
        <p className="mt-3 text-sm text-[#7b8494]">{note}</p>
      ) : null}
    </div>
  );
}
