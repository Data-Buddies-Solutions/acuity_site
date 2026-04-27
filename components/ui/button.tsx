"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-8 px-2.5",
        icon: "size-8",
        lg: "h-9 px-3",
        sm: "h-7 px-2.5 text-[0.8rem]",
      },
      variant: {
        default: "bg-foreground text-background hover:bg-foreground/85",
        destructive:
          "bg-red-50 text-red-700 hover:bg-red-100 focus-visible:ring-red-500/20",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-accent underline-offset-4 hover:underline",
        outline: "border-border bg-background hover:bg-muted hover:text-foreground",
        secondary: "bg-muted text-foreground hover:bg-muted/80",
      },
    },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

function Button({
  className,
  size = "default",
  type = "button",
  variant = "default",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ className, size, variant }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
