import * as React from "react";

import { cn } from "@/lib/utils";

const Panel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-black/5 bg-white/60 p-6 shadow-sm backdrop-blur",
        className,
      )}
      {...props}
    />
  ),
);
Panel.displayName = "Panel";

const PanelHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("mb-4 space-y-1.5", className)} {...props} />
));
PanelHeader.displayName = "PanelHeader";

const PanelTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref as React.Ref<HTMLHeadingElement>}
    className={cn("text-xl font-semibold tracking-tight text-foreground", className)}
    {...props}
  />
));
PanelTitle.displayName = "PanelTitle";

const PanelDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-foreground/70", className)} {...props} />
));
PanelDescription.displayName = "PanelDescription";

const PanelContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-sm leading-relaxed", className)} {...props} />
));
PanelContent.displayName = "PanelContent";

export { Panel, PanelContent, PanelDescription, PanelHeader, PanelTitle };
