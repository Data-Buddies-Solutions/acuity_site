import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all [&>svg]:size-3",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "bg-accent text-white",
        destructive: "bg-red-50 text-red-700",
        ghost: "hover:bg-muted hover:text-muted-foreground",
        outline: "border-border text-foreground",
        secondary: "bg-muted text-foreground",
      },
    },
  },
);

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ className, variant }))} {...props} />
  );
}

export { Badge, badgeVariants };
