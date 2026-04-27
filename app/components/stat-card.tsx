"use client";

import { cn } from "@/lib/utils";
import { AnimatedValue } from "@/app/components/animated-value";

export function StatCard({
  label,
  value,
  sub,
  color,
  size = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  size?: "default" | "hero";
}) {
  return (
    <div
      className={cn(
        "group relative rounded-xl border border-white/60 bg-white/70 backdrop-blur-lg px-4 transition-all duration-300 hover:bg-white hover:border-gray-200/60 hover:shadow-[0_0_24px_-4px_rgba(0,0,0,0.1)] hover:-translate-y-[1px]",
        size === "hero" ? "py-4" : "py-3"
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono font-semibold leading-none tabular-nums tracking-tight text-[#10272c]",
          size === "hero" ? "text-2xl" : "text-lg",
          color
        )}
      >
        <AnimatedValue value={value} />
      </p>
      {sub && (
        <p className="mt-1.5 text-[10px] font-mono leading-tight text-gray-500 tabular-nums">
          {sub}
        </p>
      )}
    </div>
  );
}
