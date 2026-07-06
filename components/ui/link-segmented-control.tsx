import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

type LinkSegmentedControlItem = {
  href: string;
  label: ReactNode;
  value: string;
};

export function LinkSegmentedControl({
  activeClassName,
  ariaLabel,
  className,
  inactiveClassName,
  itemClassName,
  items,
  value,
}: Readonly<{
  activeClassName?: string;
  ariaLabel: string;
  className?: string;
  inactiveClassName?: string;
  itemClassName?: string;
  items: LinkSegmentedControlItem[];
  value: string;
}>) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn("inline-flex w-fit rounded-lg bg-muted p-1", className)}
    >
      {items.map((item) => {
        const selected = item.value === value;

        return (
          <Link
            aria-current={selected ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors",
              selected
                ? cn("bg-background text-foreground shadow-sm", activeClassName)
                : cn("text-muted-foreground hover:text-foreground", inactiveClassName),
              itemClassName,
            )}
            href={item.href}
            key={item.value}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
