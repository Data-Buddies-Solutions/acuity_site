"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

type TabsContextValue = {
  baseId: string;
  onValueChange?: (value: string) => void;
  orientation: "horizontal" | "vertical";
  value?: string;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

function tabPartId(baseId: string, part: "content" | "trigger", value: string) {
  return `${baseId}-${part}-${encodeURIComponent(value)}`;
}

function Tabs({
  className,
  defaultValue,
  id,
  onValueChange,
  orientation = "horizontal",
  value,
  ...props
}: React.ComponentProps<"div"> & {
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: "horizontal" | "vertical";
  value?: string;
}) {
  const generatedId = React.useId();
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const currentValue = value ?? internalValue;
  const baseId = id ?? generatedId;

  const context = React.useMemo(
    () => ({
      baseId,
      orientation,
      value: currentValue,
      onValueChange: (nextValue: string) => {
        setInternalValue(nextValue);
        onValueChange?.(nextValue);
      },
    }),
    [baseId, currentValue, onValueChange, orientation],
  );

  return (
    <TabsContext.Provider value={context}>
      <div
        data-slot="tabs"
        data-orientation={orientation}
        id={id}
        className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
        {...props}
      />
    </TabsContext.Provider>
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
  },
);

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof tabsListVariants>) {
  const context = React.useContext(TabsContext);

  return (
    <div
      data-slot="tabs-list"
      data-variant={variant}
      role="tablist"
      aria-orientation={context?.orientation ?? "horizontal"}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  id,
  onClick,
  onKeyDown,
  tabIndex,
  value,
  ...props
}: React.ComponentProps<"button"> & { value: string }) {
  const context = React.useContext(TabsContext);
  const active = context?.value === value;
  const triggerId = context ? tabPartId(context.baseId, "trigger", value) : undefined;
  const contentId = context ? tabPartId(context.baseId, "content", value) : undefined;

  function moveFocus(
    event: React.KeyboardEvent<HTMLButtonElement>,
    target: "first" | "last" | "next" | "previous",
  ) {
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]:not([disabled]):not([aria-disabled="true"])',
      ) ?? [],
    );
    const currentIndex = tabs.indexOf(event.currentTarget);

    if (currentIndex === -1 || tabs.length === 0) {
      return;
    }

    const targetIndex =
      target === "first"
        ? 0
        : target === "last"
          ? tabs.length - 1
          : target === "next"
            ? (currentIndex + 1) % tabs.length
            : (currentIndex - 1 + tabs.length) % tabs.length;
    const targetTab = tabs[targetIndex];

    targetTab.focus();
    targetTab.click();
  }

  return (
    <button
      type="button"
      data-slot="tabs-trigger"
      data-active={active ? "" : undefined}
      id={id ?? triggerId}
      role="tab"
      aria-controls={contentId}
      aria-selected={active}
      tabIndex={tabIndex ?? (context?.value === undefined || active ? 0 : -1)}
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-[background-color,border-color,color,box-shadow] group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className,
      )}
      {...props}
      onKeyDown={(event) => {
        onKeyDown?.(event);

        if (event.defaultPrevented) {
          return;
        }

        if (event.key === "Home") {
          event.preventDefault();
          moveFocus(event, "first");
          return;
        }

        if (event.key === "End") {
          event.preventDefault();
          moveFocus(event, "last");
          return;
        }

        if (context?.orientation === "vertical") {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            moveFocus(event, "next");
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveFocus(event, "previous");
          }
          return;
        }

        if (event.key === "ArrowRight") {
          event.preventDefault();
          moveFocus(event, "next");
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          moveFocus(event, "previous");
        }
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          context?.onValueChange?.(value);
        }
      }}
    />
  );
}

function TabsContent({
  "aria-labelledby": ariaLabelledBy,
  className,
  id,
  value,
  ...props
}: React.ComponentProps<"div"> & { value: string }) {
  const context = React.useContext(TabsContext);
  const triggerId = context ? tabPartId(context.baseId, "trigger", value) : undefined;
  const contentId = context ? tabPartId(context.baseId, "content", value) : undefined;

  if (context?.value !== value) {
    return null;
  }

  return (
    <div
      data-slot="tabs-content"
      id={id ?? contentId}
      role="tabpanel"
      aria-labelledby={ariaLabelledBy ?? triggerId}
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
