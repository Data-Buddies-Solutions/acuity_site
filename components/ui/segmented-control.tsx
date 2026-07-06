import * as React from "react";

import { cn } from "@/lib/utils";

type SegmentedControlItem = {
  disabled?: boolean;
  label: React.ReactNode;
  value: string;
};

type SegmentedControlProps = {
  "aria-label": string;
  className?: string;
  itemClassName?: string;
  items: readonly SegmentedControlItem[];
  onValueChange: (value: string) => void;
  value: string;
};

function SegmentedControl({
  "aria-label": ariaLabel,
  className,
  itemClassName,
  items,
  onValueChange,
  value,
}: SegmentedControlProps) {
  const buttonRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const enabledItems = items.filter((item) => !item.disabled);
  const activeTabValue =
    enabledItems.find((item) => item.value === value)?.value ?? enabledItems[0]?.value;

  function selectAndFocus(nextValue: string) {
    if (nextValue !== value) {
      onValueChange(nextValue);
    }
    buttonRefs.current[nextValue]?.focus();
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentValue: string,
  ) {
    if (!enabledItems.length) {
      return;
    }

    const currentIndex = enabledItems.findIndex((item) => item.value === currentValue);
    const fallbackIndex = Math.max(
      0,
      enabledItems.findIndex((item) => item.value === activeTabValue),
    );
    const index = currentIndex >= 0 ? currentIndex : fallbackIndex;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectAndFocus(enabledItems[(index + 1) % enabledItems.length].value);
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectAndFocus(
        enabledItems[(index - 1 + enabledItems.length) % enabledItems.length].value,
      );
    }

    if (event.key === "Home") {
      event.preventDefault();
      selectAndFocus(enabledItems[0].value);
    }

    if (event.key === "End") {
      event.preventDefault();
      selectAndFocus(enabledItems[enabledItems.length - 1].value);
    }
  }

  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-lg bg-muted p-1",
        className,
      )}
      role="radiogroup"
    >
      {items.map((item) => {
        const selected = item.value === value;

        return (
          <button
            key={item.value}
            ref={(node) => {
              buttonRefs.current[item.value] = node;
            }}
            aria-checked={selected}
            className={cn(
              "inline-flex h-8 min-w-0 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground transition hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
              selected && "bg-background text-foreground shadow-sm",
              itemClassName,
            )}
            disabled={item.disabled}
            role="radio"
            tabIndex={item.value === activeTabValue ? 0 : -1}
            type="button"
            onKeyDown={(event) => handleKeyDown(event, item.value)}
            onClick={() => {
              if (!selected) onValueChange(item.value);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export { SegmentedControl, type SegmentedControlItem };
