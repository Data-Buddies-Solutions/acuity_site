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
    <div className="rounded-xl border border-black/6 bg-white px-5 py-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6f8083]">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-normal text-[#10272c] sm:text-4xl">
        {value}
      </p>
      {delta && DeltaIcon ? (
        <p
          className={cn(
            "mt-2 inline-flex items-center gap-1 text-sm font-medium",
            deltaStyles[delta.direction],
          )}
        >
          <DeltaIcon className="h-4 w-4" aria-hidden="true" />
          {delta.label}
        </p>
      ) : note ? (
        <p className="mt-2 text-sm text-[#617477]">{note}</p>
      ) : null}
    </div>
  );
}
