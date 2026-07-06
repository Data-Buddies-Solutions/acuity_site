import * as React from "react";

import { cn } from "@/lib/utils";

type TooltipProps = {
  children: React.ReactNode;
  className?: string;
  label: React.ReactNode;
};

function Tooltip({ children, className, label }: TooltipProps) {
  const tooltipId = React.useId();
  const trigger = React.isValidElement<{ "aria-describedby"?: string }>(children)
    ? React.cloneElement(children, {
        "aria-describedby": cn(children.props["aria-describedby"], tooltipId),
      })
    : children;

  return (
    <span className="group/tooltip relative inline-flex">
      {trigger}
      <span
        id={tooltipId}
        className={cn(
          "pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-[#151a24] px-3 py-1.5 text-sm font-medium text-white opacity-0 shadow-[0_10px_30px_rgba(16,24,40,0.18)] transition group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100",
          className,
        )}
        role="tooltip"
      >
        <span
          className="absolute -left-1 top-1/2 size-2.5 -translate-y-1/2 rotate-45 bg-[#151a24]"
          aria-hidden="true"
        />
        {label}
      </span>
    </span>
  );
}

export { Tooltip };
